import { readFileSync, writeFileSync } from "node:fs";
import { glob } from "glob";

const args = process.argv.slice(2);
const files = args.length
	? args
	: ["patchright_driver_patch.ts", ...glob.sync("driver_patches/**/*.ts")];

const callNames = new Set(["setBodyText", "replaceWithText"]);

const spacesToTabs = (text: string) => text.replace(/^( {2})+/gm, spaces => "\t".repeat(spaces.length / 2));

const leadingTabs = (line: string) => {
	let count = 0;
	for (const char of line) {
		if (char !== "\t")
			break;
		count++;
	}
	return count;
};

const findTemplateEnd = (content: string, startTickIndex: number) => {
	let i = startTickIndex + 1;
	while (i < content.length) {
		const char = content[i];
		if (char === "\\") {
			i += 2;
			continue;
		}
		if (char === "$") {
			if (content[i + 1] === "{") {
				i += 2;
				let depth = 1;
				while (i < content.length && depth > 0) {
					const exprChar = content[i];
					if (exprChar === "\\") {
						i += 2;
						continue;
					}
					if (exprChar === "{")
						depth++;
					else if (exprChar === "}")
						depth--;
					i++;
				}
				continue;
			}
			i++;
			continue;
		}
		if (char === "`")
			return i;
		i++;
	}
	return -1;
};

const shouldSkipSemicolon = (trimmed: string) => {
	if (!trimmed)
		return true;
	if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*"))
		return true;
	if (/[;,{:]$/.test(trimmed) || trimmed === "}" || trimmed === "{")
		return true;
	if (/^(if|for|while|switch|catch)\b/.test(trimmed) && trimmed.endsWith(")"))
		return true;
	if (/^(else\b|try\b|do\b)/.test(trimmed))
		return true;
	return false;
};

const maybeAddSemicolon = (line: string, nextLine: string | undefined) => {
	const trailingWsMatch = line.match(/\s*$/);
	const trailingWs = trailingWsMatch ? trailingWsMatch[0] : "";
	const core = line.slice(0, line.length - trailingWs.length);
	const trimmed = core.trim();
	const nextTrimmed = (nextLine ?? "").trim();

	if (shouldSkipSemicolon(trimmed))
		return line;
	if (/^(\.|\?\.|\[)/.test(nextTrimmed))
		return line;

	const startsStatement = /^(return|throw|break|continue|const|let|var|await|yield|import\(|export\s|this\.|super\.|[A-Za-z_$][\w$]*\s*=)/.test(trimmed);
	const endsLikeStatement = /[\]\)"'`\w]$/.test(trimmed);

	if (startsStatement && endsLikeStatement)
		return `${core};${trailingWs}`;

	return line;
};

const addMissingSemicolons = (content: string) => {
	const lines = content.split("\n");
	const output: string[] = [];
	for (let i = 0; i < lines.length; i++)
		output.push(maybeAddSemicolon(lines[i], lines[i + 1]));
	return output.join("\n");
};

const normalizeTemplateClosing = (closingTail: string) => {
	const afterTick = closingTail.slice(1).trim();
	if (afterTick === ")" || afterTick === ");")
		return "`);";
	if (!afterTick)
		return "`";
	return `\`${afterTick}`;
};

const normalizeTemplateBodyIndentation = (content: string) => {
	const names = [...callNames].join("|");
	const callRegex = new RegExp(`(${names})\\s*\\(\\s*\`` , "g");

	let result = "";
	let cursor = 0;
	let match: RegExpExecArray | null;

	while ((match = callRegex.exec(content)) !== null) {
		const openTickIndex = callRegex.lastIndex - 1;
		const closeTickIndex = findTemplateEnd(content, openTickIndex);
		if (closeTickIndex === -1)
			break;

		const callLineStart = content.lastIndexOf("\n", match.index) + 1;
		const baseLine = content.slice(callLineStart, match.index);
		const baseIndent = leadingTabs(baseLine);

		const lineEndAfterCloseTick = content.indexOf("\n", closeTickIndex);
		const closeLineEnd = lineEndAfterCloseTick === -1 ? content.length : lineEndAfterCloseTick;
		const templateBody = content.slice(openTickIndex + 1, closeTickIndex).replace(/[ \t]*$/, "");
		const normalizedBody = addMissingSemicolons(normalizeOneTemplateBody(templateBody, baseIndent));
		const closingTail = content.slice(closeTickIndex, closeLineEnd);
		const normalizedClosing = "\t".repeat(baseIndent) + normalizeTemplateClosing(closingTail);

		result += content.slice(cursor, openTickIndex + 1);
		result += normalizedBody;
		result += normalizedClosing;
		cursor = closeLineEnd;
		callRegex.lastIndex = cursor;
	}

	result += content.slice(cursor);
	return result;
};

const normalizeOneTemplateBody = (templateBody: string, baseIndent: number) => {
	if (!templateBody.includes("\n"))
		return templateBody;

	const lines = templateBody.split("\n");
	const desiredMinIndent = baseIndent + 1;

	let minIndent = Number.POSITIVE_INFINITY;
	for (const line of lines) {
		const lineWithTabs = spacesToTabs(line);
		if (!lineWithTabs.trim())
			continue;
		const indent = leadingTabs(lineWithTabs);
		if (indent < minIndent)
			minIndent = indent;
	}

	if (!Number.isFinite(minIndent))
		return templateBody;

	const delta = desiredMinIndent - minIndent;
	const normalizedLines = lines.map(line => {
		const lineWithTabs = spacesToTabs(line);
		if (!lineWithTabs.trim())
			return "";

		if (delta === 0)
			return lineWithTabs;

		if (delta > 0)
			return "\t".repeat(delta) + lineWithTabs;

		let toRemove = -delta;
		let i = 0;
		while (toRemove > 0 && i < lineWithTabs.length && lineWithTabs[i] === "\t") {
			i++;
			toRemove--;
		}
		return lineWithTabs.slice(i);
	});

	return normalizedLines.join("\n");
};

for (const file of files) {
	const original = readFileSync(file, "utf8");
	const withTabs = spacesToTabs(original);
	const withTemplateNormalization = normalizeTemplateBodyIndentation(withTabs);
	const fixed = addMissingSemicolons(withTemplateNormalization);
	if (fixed !== original)
		writeFileSync(file, fixed);
}
 