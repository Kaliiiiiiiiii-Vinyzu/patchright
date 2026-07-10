import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { glob } from "glob";
import { format, type Options } from "prettier";

const DEFAULT_PATTERNS = ["patchright_driver_patch.ts", "driver_patches/**/*.ts"];
const FORMATTABLE_FILES = "**/*.{cjs,cts,js,jsx,json,jsonc,mjs,mts,ts,tsx,yaml,yml}";
const MAX_FORMAT_PASSES = 10;
const PATCH_SOURCE_OPTIONS: Options = {
	arrowParens: "avoid",
	printWidth: 180,
	tabWidth: 2,
	useTabs: true,
};

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
		const next = await format(formatted, { ...options, filepath: file });
		if (next === formatted) return formatted;
		formatted = next;
	}
	throw new Error(`Formatter did not converge after ${MAX_FORMAT_PASSES} passes: ${file}`);
}

export async function formatFiles(patterns: readonly string[], options: Options = {}) {
	const files = await resolveFiles(patterns);
	const formattedFiles: { file: string; formatted: string; source: string }[] = [];
	for (const file of files) {
		const source = await readFile(file, "utf8");
		const formatted = await formatUntilStable(source, file, options);
		formattedFiles.push({ file, formatted, source });
	}

	for (const { file, formatted, source } of formattedFiles) {
		if (formatted !== source) await writeFile(file, formatted);
	}

	for (const { file, formatted } of formattedFiles) {
		if ((await readFile(file, "utf8")) !== formatted) throw new Error(`Failed to format: ${file}`);
	}

	return files;
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) await formatFiles(process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_PATTERNS, PATCH_SOURCE_OPTIONS);
