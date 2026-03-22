import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { Project, ScriptKind, SyntaxKind, type Node } from "ts-morph";
import { extractPatchedSymbols, type PatchedSymbolKind, type PatchedSymbolRecord } from "./extract_patched_symbols.ts";

type ChangeType = "signature_changed" | "body_changed" | "symbol_removed" | "symbol_added" | "unchanged";

type SymbolImpactRow = PatchedSymbolRecord & {
  changeType: ChangeType;
  diffLine: number | null;
  diffSide: "L" | "R" | null;
  diffSnippet: string;
};

type CompareApiFile = {
  filename: string;
  status?: string;
  patch?: string;
};

type ParsedArgs = {
  oldVersion: string;
  newVersion: string;
  reportPath: string;
  summaryPath: string;
  diffPath: string;
};

type DiffParsedLine = {
  raw: string;
  side: "L" | "R" | "C";
  oldLine: number | null;
  newLine: number | null;
};

type DiffHunk = {
  lines: DiffParsedLine[];
};

type ParsedPatch = {
  hunks: DiffHunk[];
  additions: Array<{ line: number; text: string }>;
  deletions: Array<{ line: number; text: string }>;
};

const RELEVANT_PATH_PREFIXES = [
  "packages/playwright-core/src/server/",
  "packages/playwright-core/src/utils/isomorphic/",
  "packages/playwright-core/src/injected/src/",
  "packages/injected/src/",
  "packages/playwright-core/src/server/dispatchers/",
  "packages/playwright-core/src/recorder/src/",
  "packages/recorder/src/",
  "packages/protocol/src/",
];

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    oldVersion: "",
    newVersion: "",
    reportPath: "report.json",
    summaryPath: "step_summary.md",
    diffPath: "affected_diff.patch",
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (!value) continue;

    if (arg === "--old-version") {
      args.oldVersion = value;
      i += 1;
      continue;
    }
    if (arg === "--new-version") {
      args.newVersion = value;
      i += 1;
      continue;
    }
    if (arg === "--report") {
      args.reportPath = value;
      i += 1;
      continue;
    }
    if (arg === "--summary") {
      args.summaryPath = value;
      i += 1;
      continue;
    }
    if (arg === "--diff") {
      args.diffPath = value;
      i += 1;
      continue;
    }
  }

  if (!args.oldVersion || !args.newVersion) {
    throw new Error("Both --old-version and --new-version are required");
  }

  return args;
}

function normalizeVersion(version: string): string {
  return version.startsWith("v") ? version.slice(1) : version;
}

function toTag(version: string): string {
  return version.startsWith("v") ? version : `v${version}`;
}

function isRelevantPath(filePath: string): boolean {
  return RELEVANT_PATH_PREFIXES.some((prefix) => filePath.startsWith(prefix));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeUnderscore(value: string): string {
  return value.replaceAll("_", "\\_");
}

function colorTextToken(value: string, color: string): string {
  return `\${\\color{${color}}\\text{${escapeUnderscore(value)}}}$`;
}

function changeTypeColor(changeType: ChangeType): string {
  if (changeType === "signature_changed") return "brown";
  if (changeType === "symbol_removed") return "brown";
  if (changeType === "symbol_added") return "orange";
  return "orange";
}

function kindColor(kind: PatchedSymbolKind): string {
  return kind === "class" ? "green" : "lime";
}

function getDeclSignatureText(node: Node): string {
  if (node.getKind() === SyntaxKind.FunctionDeclaration) {
    const functionNode = node.asKindOrThrow(SyntaxKind.FunctionDeclaration);
    const name = functionNode.getName() ?? "";
    const params = functionNode.getParameters().map((param) => {
      const rest = param.isRestParameter() ? "..." : "";
      const typeNode = param.getTypeNode();
      const type = typeNode ? `: ${typeNode.getText()}` : "";
      const optional = param.isOptional() ? "?" : "";
      return `${rest}${param.getName()}${optional}${type}`;
    });
    const returnTypeNode = functionNode.getReturnTypeNode();
    const returnType = returnTypeNode ? `: ${returnTypeNode.getText()}` : "";
    return `${name}(${params.join(",")})${returnType}`;
  }

  if (node.getKind() === SyntaxKind.MethodDeclaration) {
    const methodNode = node.asKindOrThrow(SyntaxKind.MethodDeclaration);
    const name = methodNode.getName() ?? "";
    const params = methodNode.getParameters().map((param) => {
      const rest = param.isRestParameter() ? "..." : "";
      const typeNode = param.getTypeNode();
      const type = typeNode ? `: ${typeNode.getText()}` : "";
      const optional = param.isOptional() ? "?" : "";
      return `${rest}${param.getName()}${optional}${type}`;
    });
    const returnTypeNode = methodNode.getReturnTypeNode();
    const returnType = returnTypeNode ? `: ${returnTypeNode.getText()}` : "";
    return `${name}(${params.join(",")})${returnType}`;
  }

  return node.getText();
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

function getDeclarationRangeForNode(node: Node): { start: number; end: number } {
  const start = node.getStartLineNumber();

  if (node.getKind() === SyntaxKind.MethodDeclaration) {
    const methodNode = node.asKindOrThrow(SyntaxKind.MethodDeclaration);
    const body = methodNode.getBody();
    const end = body ? Math.max(start, body.getStartLineNumber() - 1) : methodNode.getEndLineNumber();
    return { start, end };
  }

  if (node.getKind() === SyntaxKind.FunctionDeclaration) {
    const fnNode = node.asKindOrThrow(SyntaxKind.FunctionDeclaration);
    const body = fnNode.getBody();
    const end = body ? Math.max(start, body.getStartLineNumber() - 1) : fnNode.getEndLineNumber();
    return { start, end };
  }

  return { start, end: node.getEndLineNumber() };
}

function getBodyRangeForNode(node: Node): { start: number; end: number } | null {
  if (node.getKind() === SyntaxKind.MethodDeclaration) {
    const methodNode = node.asKindOrThrow(SyntaxKind.MethodDeclaration);
    const body = methodNode.getBody();
    if (!body) return null;
    return { start: body.getStartLineNumber(), end: body.getEndLineNumber() };
  }

  if (node.getKind() === SyntaxKind.FunctionDeclaration) {
    const fnNode = node.asKindOrThrow(SyntaxKind.FunctionDeclaration);
    const body = fnNode.getBody();
    if (!body) return null;
    return { start: body.getStartLineNumber(), end: body.getEndLineNumber() };
  }

  return { start: node.getStartLineNumber(), end: node.getEndLineNumber() };
}

function lineInRange(line: number, range: { start: number; end: number } | null): boolean {
  if (!range) return false;
  return line >= range.start && line <= range.end;
}

function yamlPathExists(protocolDocument: unknown, dotPath: string): boolean {
  const pathParts = dotPath.split(".");
  let current: unknown = protocolDocument;
  for (const part of pathParts) {
    if (current == null || typeof current !== "object" || !(part in (current as Record<string, unknown>))) {
      return false;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return true;
}

function parsePatch(patchText: string): ParsedPatch {
  const additions: Array<{ line: number; text: string }> = [];
  const deletions: Array<{ line: number; text: string }> = [];
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;

  let oldLine = 0;
  let newLine = 0;

  for (const rawLine of patchText.split("\n")) {
    const hunkMatch = rawLine.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
    if (hunkMatch) {
      currentHunk = { lines: [] };
      hunks.push(currentHunk);
      oldLine = Number.parseInt(hunkMatch[1], 10);
      newLine = Number.parseInt(hunkMatch[2], 10);
      continue;
    }

    if (!currentHunk) continue;

    if (rawLine.startsWith("+")) {
      currentHunk.lines.push({ raw: rawLine, side: "R", oldLine: null, newLine });
      additions.push({ line: newLine, text: rawLine.slice(1) });
      newLine += 1;
      continue;
    }

    if (rawLine.startsWith("-")) {
      currentHunk.lines.push({ raw: rawLine, side: "L", oldLine, newLine: null });
      deletions.push({ line: oldLine, text: rawLine.slice(1) });
      oldLine += 1;
      continue;
    }

    if (rawLine.startsWith(" ")) {
      currentHunk.lines.push({ raw: rawLine, side: "C", oldLine, newLine });
      oldLine += 1;
      newLine += 1;
      continue;
    }

    if (rawLine.startsWith("\\")) {
      currentHunk.lines.push({ raw: rawLine, side: "C", oldLine: null, newLine: null });
    }
  }

  return { hunks, additions, deletions };
}

function diffSnippetForAnchor(parsedPatch: ParsedPatch, side: "L" | "R" | null, line: number | null): string {
  const allChangedLines = parsedPatch.hunks.flatMap((hunk) => hunk.lines.filter((diffLine) => diffLine.side !== "C"));
  if (allChangedLines.length === 0) return " No diff hunk available.";

  let targetHunk: DiffHunk | null = null;
  let targetIndex = -1;

  for (const hunk of parsedPatch.hunks) {
    for (let i = 0; i < hunk.lines.length; i += 1) {
      const diffLine = hunk.lines[i];
      if (side === "R" && line != null && diffLine.side === "R" && diffLine.newLine === line) {
        targetHunk = hunk;
        targetIndex = i;
        break;
      }
      if (side === "L" && line != null && diffLine.side === "L" && diffLine.oldLine === line) {
        targetHunk = hunk;
        targetIndex = i;
        break;
      }
    }
    if (targetHunk) break;
  }

  if (!targetHunk) {
    targetHunk = parsedPatch.hunks.find((hunk) => hunk.lines.some((diffLine) => diffLine.side !== "C")) ?? null;
    if (!targetHunk) return " No diff hunk available.";
    targetIndex = targetHunk.lines.findIndex((diffLine) => diffLine.side !== "C");
  }

  if (targetIndex < 0) return " No diff hunk available.";

  let leftChanged = targetIndex;
  while (leftChanged > 0 && targetHunk.lines[leftChanged - 1].side !== "C") leftChanged -= 1;

  let rightChanged = targetIndex;
  while (rightChanged < targetHunk.lines.length - 1 && targetHunk.lines[rightChanged + 1].side !== "C") rightChanged += 1;

  const start = Math.max(0, leftChanged - 3);
  const end = Math.min(targetHunk.lines.length - 1, rightChanged + 3);

  return targetHunk.lines.slice(start, end + 1).map((diffLine) => diffLine.raw).join("\n");
}

function diffSnippetForAnchorWithContext(parsedPatch: ParsedPatch, side: "L" | "R" | null, line: number | null, contextLines: number): string {
  const allChangedLines = parsedPatch.hunks.flatMap((hunk) => hunk.lines.filter((diffLine) => diffLine.side !== "C"));
  if (allChangedLines.length === 0) return " No diff hunk available.";

  let targetHunk: DiffHunk | null = null;
  let targetIndex = -1;

  for (const hunk of parsedPatch.hunks) {
    for (let i = 0; i < hunk.lines.length; i += 1) {
      const diffLine = hunk.lines[i];
      if (side === "R" && line != null && diffLine.side === "R" && diffLine.newLine === line) {
        targetHunk = hunk;
        targetIndex = i;
        break;
      }
      if (side === "L" && line != null && diffLine.side === "L" && diffLine.oldLine === line) {
        targetHunk = hunk;
        targetIndex = i;
        break;
      }
    }
    if (targetHunk) break;
  }

  if (!targetHunk) {
    targetHunk = parsedPatch.hunks.find((hunk) => hunk.lines.some((diffLine) => diffLine.side !== "C")) ?? null;
    if (!targetHunk) return " No diff hunk available.";
    targetIndex = targetHunk.lines.findIndex((diffLine) => diffLine.side !== "C");
  }

  if (targetIndex < 0) return " No diff hunk available.";

  let leftChanged = targetIndex;
  while (leftChanged > 0 && targetHunk.lines[leftChanged - 1].side !== "C") leftChanged -= 1;

  let rightChanged = targetIndex;
  while (rightChanged < targetHunk.lines.length - 1 && targetHunk.lines[rightChanged + 1].side !== "C") rightChanged += 1;

  const start = Math.max(0, leftChanged - contextLines);
  const end = Math.min(targetHunk.lines.length - 1, rightChanged + contextLines);
  return targetHunk.lines.slice(start, end + 1).map((diffLine) => diffLine.raw).join("\n");
}

function normalizeLineEndings(text: string): string[] {
  return text.replace(/\r\n/g, "\n").split("\n");
}

function lineDiff(oldLines: string[], newLines: string[]): Array<{ kind: " " | "+" | "-"; text: string }> {
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array<number>(n + 1).fill(0));

  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      if (oldLines[i] === newLines[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: Array<{ kind: " " | "+" | "-"; text: string }> = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      out.push({ kind: " ", text: oldLines[i] });
      i += 1;
      j += 1;
      continue;
    }

    if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: "-", text: oldLines[i] });
      i += 1;
    } else {
      out.push({ kind: "+", text: newLines[j] });
      j += 1;
    }
  }

  while (i < m) {
    out.push({ kind: "-", text: oldLines[i] });
    i += 1;
  }
  while (j < n) {
    out.push({ kind: "+", text: newLines[j] });
    j += 1;
  }

  return out;
}

function getNodeBodyText(node: Node | null): string | null {
  if (!node) return null;
  if (node.getKind() === SyntaxKind.MethodDeclaration) {
    const methodNode = node.asKindOrThrow(SyntaxKind.MethodDeclaration);
    return methodNode.getBody()?.getText() ?? null;
  }
  if (node.getKind() === SyntaxKind.FunctionDeclaration) {
    const fnNode = node.asKindOrThrow(SyntaxKind.FunctionDeclaration);
    return fnNode.getBody()?.getText() ?? null;
  }
  return null;
}

function makeMethodOrFunctionDiffSnippet(oldNode: Node | null, newNode: Node | null, fallbackSnippet: string): string {
  const oldBodyText = getNodeBodyText(oldNode);
  const newBodyText = getNodeBodyText(newNode);
  if (oldBodyText == null && newBodyText == null) return fallbackSnippet;

  const oldLines = oldBodyText ? normalizeLineEndings(oldBodyText) : [];
  const newLines = newBodyText ? normalizeLineEndings(newBodyText) : [];
  const longest = Math.max(oldLines.length, newLines.length);
  if (longest > 80) return fallbackSnippet;

  const diff = lineDiff(oldLines, newLines);
  if (diff.length === 0) return fallbackSnippet;
  return diff.map((line) => `${line.kind}${line.text}`).join("\n");
}

function compareAffectedKind(a: SymbolImpactRow, b: SymbolImpactRow): number {
  const rankA = a.kind === "class" ? 0 : 1;
  const rankB = b.kind === "class" ? 0 : 1;
  if (rankA !== rankB) return rankA - rankB;
  if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
  return a.symbol.localeCompare(b.symbol);
}

function makePlaywrightFileUrl(playwrightFile: string, newTag: string, startLine: number | null, endLine: number | null): string {
  const start = startLine ?? 1;
  const end = endLine ?? start;
  return `https://github.com/microsoft/playwright/blob/${newTag}/${playwrightFile}#L${start}-L${end}`;
}

function makePatchFileUrl(patchFile: string, sha: string, startLine: number | null, endLine: number | null): string {
  const patchPath = patchFile === "patchright_driver_patch.ts" ? patchFile : `driver_patches/${patchFile}`;
  const start = startLine ?? 1;
  const end = endLine ?? start;
  return `https://github.com/Kaliiiiiiiiii-Vinyzu/patchright/blob/${sha}/${patchPath}#L${start}-L${end}`;
}

async function fetchJson<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "User-Agent": "patchright-check-patch-impact",
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }

  return (await response.json()) as T;
}

async function fetchRawFile(tag: string, filePath: string, token: string): Promise<string | null> {
  const url = `https://raw.githubusercontent.com/microsoft/playwright/${tag}/${filePath}`;
  const response = await fetch(url, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "User-Agent": "patchright-check-patch-impact",
    },
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Failed to fetch ${filePath} at ${tag}: HTTP ${response.status}`);
  }
  return response.text();
}

function getProtocolChangeType(symbol: string, oldProtocol: unknown, newProtocol: unknown): ChangeType {
  const existedInOld = yamlPathExists(oldProtocol, symbol);
  const existsInNew = yamlPathExists(newProtocol, symbol);

  if (existedInOld && !existsInNew) return "symbol_removed";
  if (!existedInOld && existsInNew) return "symbol_added";
  return "unchanged";
}

function formatAffectedDetail(row: SymbolImpactRow, oldTag: string, newTag: string, sha: string): string {
  const kindToken = colorTextToken(row.kind, kindColor(row.kind));
  const changeToken = colorTextToken(row.changeType, changeTypeColor(row.changeType));
  const playwrightUrl = makePlaywrightFileUrl(
    row.playwrightFile,
    newTag,
    row.playwrightFileLineStart,
    row.playwrightFileLineEnd
  );
  const patchUrl = makePatchFileUrl(row.patchFile, sha, row.patchFileLineStart, row.patchFileLineEnd);

  const diffSnippet = row.diffSnippet || " No diff hunk available.";

  return [
    "<details>",
    `<summary><code>${row.symbol}</code> &nbsp;·&nbsp; (${kindToken} | ${changeToken})</summary>`,
    "",
    `**Playwright File:** [${row.playwrightFile}](${playwrightUrl})`,
    "</br>",
    `**Patch File:** [${row.patchFile}](${patchUrl})`,
    "```diff",
    diffSnippet,
    "```",
    "",
    "</details>",
  ].join("\n");
}

function formatUnaffectedTable(unaffectedRows: SymbolImpactRow[], newTag: string, sha: string): string {
  const lines = [
    "| Symbol | Kind | Playwright File | Patch File |",
    "|--------|------|-----------------|------------|",
  ];

  for (const row of unaffectedRows) {
    const pwUrl = makePlaywrightFileUrl(
      row.playwrightFile,
      newTag,
      row.playwrightFileLineStart,
      row.playwrightFileLineEnd
    );
    const patchUrl = makePatchFileUrl(row.patchFile, sha, row.patchFileLineStart, row.patchFileLineEnd);
    lines.push(`| ${row.symbol} | ${row.kind} | [${row.playwrightFile}](${pwUrl}) | [${row.patchFile}](${patchUrl}) |`);
  }

  return lines.join("\n");
}

function toPatchSection(playwrightFile: string, patchText: string): string {
  const body = patchText.trimEnd();

  return [
    `diff --git a/${playwrightFile} b/${playwrightFile}`,
    `--- a/${playwrightFile}`,
    `+++ b/${playwrightFile}`,
    body,
  ].join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const oldVersion = normalizeVersion(args.oldVersion);
  const newVersion = normalizeVersion(args.newVersion);
  const oldTag = toTag(oldVersion);
  const newTag = toTag(newVersion);
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  const sha = process.env.GITHUB_SHA || "main";

  const compareUrl = `https://api.github.com/repos/microsoft/playwright/compare/${oldTag}...${newTag}`;
  const compare = await fetchJson<{ files?: CompareApiFile[] }>(compareUrl, token);

  const compareFiles = (compare.files ?? []).filter((file) => isRelevantPath(file.filename));
  const patchByFile = new Map(compareFiles.map((file) => [file.filename, file.patch ?? ""]));
  const statusByFile = new Map(compareFiles.map((file) => [file.filename, file.status ?? "modified"]));
  const parsedPatchByFile = new Map(compareFiles.map((file) => [file.filename, parsePatch(file.patch ?? "")]));

  const symbols = await extractPatchedSymbols({ newVersionTag: newTag, githubToken: token });

  const uniquePlaywrightFiles = [...new Set(symbols.map((entry) => entry.playwrightFile))];
  const fileContents = new Map<string, { oldText: string | null; newText: string | null }>();

  for (const playwrightFile of uniquePlaywrightFiles) {
    const oldText = await fetchRawFile(oldTag, playwrightFile, token);
    const newText = await fetchRawFile(newTag, playwrightFile, token);
    fileContents.set(playwrightFile, { oldText, newText });
  }

  const project = new Project({ useInMemoryFileSystem: true });

  const protocolContent = fileContents.get("packages/protocol/src/protocol.yml") || { oldText: null, newText: null };
  const oldProtocol = protocolContent.oldText ? YAML.parse(protocolContent.oldText) : {};
  const newProtocol = protocolContent.newText ? YAML.parse(protocolContent.newText) : {};

  const totalFromExtractor = symbols.length;
  const allRows: SymbolImpactRow[] = [];
  const affectedRows: SymbolImpactRow[] = [];

  for (const symbolEntry of symbols) {
    const { symbol, kind, playwrightFile, patchFile } = symbolEntry;
    let changeType: ChangeType = "unchanged";
    let diffLine: number | null = null;
    let diffSide: "L" | "R" | null = null;
    let patchFileLineStart = symbolEntry.patchFileLineStart;
    let patchFileLineEnd = symbolEntry.patchFileLineEnd;
    let playwrightFileLineStart = symbolEntry.playwrightFileLineStart;
    let playwrightFileLineEnd = symbolEntry.playwrightFileLineEnd;

    if (kind === "protocol_param" || kind === "protocol_property") {
      changeType = getProtocolChangeType(symbol, oldProtocol, newProtocol);
    } else {
      const filePatch = patchByFile.get(playwrightFile) || "";
      const parsedPatch = parsedPatchByFile.get(playwrightFile) || { hunks: [], additions: [], deletions: [] };
      const fileStatus = statusByFile.get(playwrightFile) || "modified";
      const fileData = fileContents.get(playwrightFile) || { oldText: null, newText: null };

      const oldSource = fileData.oldText ? buildSourceFile(project, `${playwrightFile}.old.ts`, fileData.oldText) : null;
      const newSource = fileData.newText ? buildSourceFile(project, `${playwrightFile}.new.ts`, fileData.newText) : null;

      const oldNodes = findNodesByKindAndSymbol(oldSource, kind, symbol);
      const newNodes = findNodesByKindAndSymbol(newSource, kind, symbol);

      const existsInOld = oldNodes.length > 0;
      const existsInNew = newNodes.length > 0;

      const primaryOldNode = oldNodes[0] ?? null;
      const primaryNewNode = newNodes[0] ?? null;

      const oldDeclRange = primaryOldNode ? getDeclarationRangeForNode(primaryOldNode) : null;
      const newDeclRange = primaryNewNode ? getDeclarationRangeForNode(primaryNewNode) : null;
      const newBodyRange = primaryNewNode ? getBodyRangeForNode(primaryNewNode) : null;

      if (primaryNewNode && (playwrightFileLineStart == null || playwrightFileLineEnd == null)) {
        const body = getBodyRangeForNode(primaryNewNode);
        playwrightFileLineStart = body?.start ?? primaryNewNode.getStartLineNumber();
        playwrightFileLineEnd = body?.end ?? primaryNewNode.getEndLineNumber();
      }

      const addedInDecl = parsedPatch.additions.find((lineInfo) => lineInRange(lineInfo.line, newDeclRange));
      const removedInDecl = parsedPatch.deletions.find((lineInfo) => lineInRange(lineInfo.line, oldDeclRange));
      const addedInBody = parsedPatch.additions.find((lineInfo) => lineInRange(lineInfo.line, newBodyRange));

      if (fileStatus === "removed" || (existsInOld && !existsInNew)) {
        changeType = "symbol_removed";
        diffSide = "L";
        diffLine = removedInDecl?.line ?? oldDeclRange?.start ?? parsedPatch.deletions[0]?.line ?? null;
      } else if (fileStatus === "added" || (!existsInOld && existsInNew)) {
        changeType = "symbol_added";
        diffSide = "R";
        diffLine = addedInDecl?.line ?? newDeclRange?.start ?? parsedPatch.additions[0]?.line ?? null;
      } else {
        const symbolPattern = new RegExp(`\\b${escapeRegExp(symbol)}\\b`);
        const patchTouchesSymbol = symbolPattern.test(filePatch);

        if (patchTouchesSymbol && (kind === "method" || kind === "function" || kind === "parameter")) {
          const oldSignatures = oldNodes.map((node) => getDeclSignatureText(node)).sort();
          const newSignatures = newNodes.map((node) => getDeclSignatureText(node)).sort();
          if (oldSignatures.join("\n") !== newSignatures.join("\n")) {
            changeType = "signature_changed";
            diffSide = "R";
            diffLine = addedInDecl?.line ?? newDeclRange?.start ?? parsedPatch.additions[0]?.line ?? null;
          } else {
            changeType = "body_changed";
            diffSide = "R";
            diffLine = addedInBody?.line ?? addedInDecl?.line ?? parsedPatch.additions[0]?.line ?? null;
          }
        } else if (patchTouchesSymbol) {
          changeType = "body_changed";
          diffSide = "R";
          diffLine = addedInBody?.line ?? addedInDecl?.line ?? parsedPatch.additions[0]?.line ?? null;
        }
      }
    }

    const parsedPatch = parsedPatchByFile.get(playwrightFile) || { hunks: [], additions: [], deletions: [] };
    let diffSnippet = "";
    if (changeType !== "unchanged") {
      const fallbackSnippet = diffSnippetForAnchorWithContext(parsedPatch, diffSide, diffLine, 10);
      if (kind === "method" || kind === "function") {
        const fileData = fileContents.get(playwrightFile) || { oldText: null, newText: null };
        const oldSource = fileData.oldText ? buildSourceFile(project, `${playwrightFile}.old.ts`, fileData.oldText) : null;
        const newSource = fileData.newText ? buildSourceFile(project, `${playwrightFile}.new.ts`, fileData.newText) : null;
        const oldNode = findNodesByKindAndSymbol(oldSource, kind, symbol)[0] ?? null;
        const newNode = findNodesByKindAndSymbol(newSource, kind, symbol)[0] ?? null;
        diffSnippet = makeMethodOrFunctionDiffSnippet(oldNode, newNode, fallbackSnippet);
      } else {
        diffSnippet = fallbackSnippet;
      }
    }

    const row: SymbolImpactRow = {
      symbol,
      kind,
      playwrightFile,
      patchFile,
      patchFileLineStart,
      patchFileLineEnd,
      playwrightFileLineStart,
      playwrightFileLineEnd,
      changeType,
      diffLine,
      diffSide,
      diffSnippet,
    };

    allRows.push(row);
    if (changeType !== "unchanged") affectedRows.push(row);
  }

  const unaffectedRows = allRows.filter((row) => row.changeType === "unchanged");
  const sortedAffectedRows = [...affectedRows].sort(compareAffectedKind);

  if (affectedRows.length + unaffectedRows.length !== totalFromExtractor) {
    throw new Error(
      `Patched symbol count mismatch: affected (${affectedRows.length}) + unaffected (${unaffectedRows.length}) != total extracted (${totalFromExtractor}).`
    );
  }

  const affectedBlocks = sortedAffectedRows.map((row) => formatAffectedDetail(row, oldTag, newTag, sha));
  if (affectedBlocks.length !== affectedRows.length) {
    throw new Error(
      `Rendered affected details mismatch: rendered (${affectedBlocks.length}) != affected array length (${affectedRows.length}).`
    );
  }
  const unaffectedTable = formatUnaffectedTable(unaffectedRows, newTag, sha);

  const summaryMarkdown = [
    `## Playwright ${oldTag} -> ${newTag}: Patch Impact Report`,
    "",
    `Breaking: ${affectedRows.length} of ${totalFromExtractor} patched symbols were affected`,
    "",
    ...affectedBlocks,
    "",
    `<details><summary>Passing: Unaffected patched symbols (${unaffectedRows.length})</summary>`,
    "",
    unaffectedTable,
    "",
    "</details>",
    "",
  ].join("\n");

  const report = {
    old_version: oldVersion,
    new_version: newVersion,
    summary: {
      total: totalFromExtractor,
      affected: affectedRows.length,
      unaffected: unaffectedRows.length,
    },
    affected: affectedRows,
    unaffected: unaffectedRows,
  };

  const affectedDiffSections: string[] = [];
  const addedSections = new Set<string>();

  for (const row of affectedRows) {
    const patch = patchByFile.get(row.playwrightFile);
    if (!patch) continue;

    const section = toPatchSection(row.playwrightFile, patch);
    if (addedSections.has(section)) continue;
    addedSections.add(section);
    affectedDiffSections.push(section);
  }

  const issueMarkdown = [
    `## Playwright ${oldTag} -> ${newTag}: Patch Impact Report`,
    "",
    `Detected ${affectedRows.length} affected patched symbol changes.`,
    "",
    ...affectedBlocks,
    "",
  ].join("\n");

  await fs.writeFile(path.resolve(args.reportPath), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(path.resolve(args.summaryPath), summaryMarkdown, "utf8");
  await fs.writeFile(path.resolve(args.diffPath), `${affectedDiffSections.join("\n\n")}\n`, "utf8");
  await fs.writeFile(path.resolve("issue_body.md"), issueMarkdown, "utf8");

  if (process.env.GITHUB_OUTPUT) {
    const output = [
      `breaking_count=${affectedRows.length}`,
      `affected_count=${affectedRows.length}`,
      `total_count=${totalFromExtractor}`,
      `issue_title=[Patch Impact] Playwright ${oldTag} -> ${newTag}: ${affectedRows.length} breaking changes detected`,
    ].join("\n");
    await fs.appendFile(process.env.GITHUB_OUTPUT, `${output}\n`, "utf8");
  }

  console.log(`Analyzed ${totalFromExtractor} patched symbols (${affectedRows.length} affected).`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
