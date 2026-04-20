import { type Project, SyntaxKind } from "ts-morph";
import { assertDefined } from "./utils.ts";

// -----------------------------------
// injected/src/xpathSelectorEngine.ts
// -----------------------------------
export function patchXPathSelectorEngine(project: Project) {
	// Add source file to the project
	const xpathSelectorEngineSourceFile = project.addSourceFileAtPath("packages/injected/src/xpathSelectorEngine.ts");

	// ------- XPathEngine Class -------
	const xPathEngineLiteral = xpathSelectorEngineSourceFile
		.getVariableDeclarationOrThrow("XPathEngine")
		.getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);

	// -- evaluateExpression Method --
	const queryAllMethod = assertDefined(
		xPathEngineLiteral.getProperty("queryAll")
	);
	queryAllMethod.asKindOrThrow(SyntaxKind.MethodDeclaration).insertStatements(0, `
		if (root.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
			const result: Element[] = [];
			// Custom ClosedShadowRoot XPath Engine
			const parser = new DOMParser();
			// Function to (recursively) get all elements in the shadowRoot
			function getAllChildElements(node) {
				const elements = [];
				const traverse = (currentNode) => {
					if (currentNode.nodeType === Node.ELEMENT_NODE) elements.push(currentNode);
					currentNode.childNodes?.forEach(traverse);
				};
				if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE || node.nodeType === Node.ELEMENT_NODE) {
					traverse(node);
				}
				return elements;
			}
			// Setting innerHTMl and childElements (all, recursive) to avoid race conditions
			const csrHTMLContent = root.innerHTML;
			const csrChildElements = getAllChildElements(root);
			const htmlDoc = parser.parseFromString(csrHTMLContent, 'text/html');
			const rootDiv = htmlDoc.body;
			const rootDivChildElements = getAllChildElements(rootDiv);
			// Use the namespace prefix in the XPath expression
			const it = htmlDoc.evaluate(selector, htmlDoc, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE);
			for (let node = it.iterateNext(); node; node = it.iterateNext()) {
				// -1 for the body element
				const nodeIndex = rootDivChildElements.indexOf(node) - 1;
				if (nodeIndex >= 0) {
					const originalNode = csrChildElements[nodeIndex];
					if (originalNode.nodeType === Node.ELEMENT_NODE)
						result.push(originalNode as Element);
				}
			}
			return result;
		}
	`);
}