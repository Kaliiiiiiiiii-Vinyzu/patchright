import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { glob } from "glob";
import { format, type Options } from "prettier";
import ts from "typescript";

const DEFAULT_PATTERNS = ["patchright_driver_patch.ts", "driver_patches/**/*.ts"];
const FORMATTABLE_FILES = "**/*.{cjs,cts,js,jsx,json,jsonc,mjs,mts,ts,tsx,yaml,yml}";
const MAX_FORMAT_PASSES = 10;
const PATCH_SOURCE_OPTIONS: Options = {
	arrowParens: "avoid",
	printWidth: 120,
	tabWidth: 2,
	useTabs: true,
};

type Replacement = {
	start: number;
	end: number;
	text: string;
};

function applyPatchSourceConventions(source: string, file: string) {
	if (!file.endsWith(".ts") && !file.endsWith(".tsx")) return source;

	const sourceFile = ts.createSourceFile(
		file,
		source,
		ts.ScriptTarget.Latest,
		true,
		file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
	);
	const replacements: Replacement[] = [];
	const visit = (node: ts.Node): void => {
		if (
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression) &&
			node.expression.name.text === "insertStatements" &&
			node.arguments.length === 2
		) {
			const [index, statements] = node.arguments;
			if (ts.isNumericLiteral(index) && index.text === "0" && ts.isTemplateLiteral(statements)) {
				replacements.push(
					{ start: node.expression.end, end: statements.getStart(sourceFile) + 1, text: "(0, `" },
					{ start: statements.end, end: node.end, text: ")" },
				);
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);

	for (const replacement of replacements.sort((a, b) => b.start - a.start))
		source = source.slice(0, replacement.start) + replacement.text + source.slice(replacement.end);
	return source;
}

async function expandPattern(pattern: string) {
	try {
		const entry = await stat(pattern);
		if (entry.isFile()) return [path.resolve(pattern)];
		if (entry.isDirectory()) return glob(FORMATTABLE_FILES, { absolute: true, cwd: pattern, nodir: true });
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
	}

	return glob(pattern, { absolute: true, nodir: true });
}

async function resolveFiles(patterns: readonly string[]) {
	const matches = await Promise.all(patterns.map(expandPattern));
	const unmatchedPattern = patterns.find((_, index) => matches[index].length === 0);
	if (unmatchedPattern) throw new Error(`No files matched: ${unmatchedPattern}`);
	return [...new Set(matches.flat().map(file => path.resolve(file)))].sort();
}

async function formatUntilStable(source: string, file: string, options: Options) {
	let formatted = source;
	for (let pass = 0; pass < MAX_FORMAT_PASSES; pass += 1) {
		const next = applyPatchSourceConventions(await format(formatted, { ...options, filepath: file }), file);
		if (next === formatted) return formatted;
		formatted = next;
	}
	throw new Error(`Formatter did not converge after ${MAX_FORMAT_PASSES} passes: ${file}`);
}

export async function formatFiles(patterns: readonly string[], options: Options = {}, check = false) {
	const files = await resolveFiles(patterns);
	const formattedFiles: { file: string; formatted: string; source: string }[] = [];
	for (const file of files) {
		const source = await readFile(file, "utf8");
		const formatted = await formatUntilStable(source, file, options);
		formattedFiles.push({ file, formatted, source });
	}

	for (const { file, formatted, source } of formattedFiles) {
		if (formatted === source) continue;
		if (check) throw new Error(`File is not formatted: ${file}`);
		await writeFile(file, formatted);
	}

	for (const { file, formatted } of formattedFiles) {
		if ((await readFile(file, "utf8")) !== formatted) throw new Error(`Failed to format: ${file}`);
	}

	return files;
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
	const args = process.argv.slice(2);
	const check = args[0] === "--check";
	if (check) args.shift();
	await formatFiles(args.length ? args : DEFAULT_PATTERNS, PATCH_SOURCE_OPTIONS, check);
}
