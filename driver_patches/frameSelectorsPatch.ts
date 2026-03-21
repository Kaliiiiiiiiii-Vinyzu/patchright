import { type Project, SyntaxKind, VariableDeclarationKind } from "ts-morph";
import { assertDefined } from "./utils.ts";

// ------------------------
// server/frameSelectors.ts
// ------------------------
export function patchFrameSelectors(project: Project) {
	// Add source file to the project
	const frameSelectorsSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/frameSelectors.ts");
	// Add the custom import and comment at the start of the file
	frameSelectorsSourceFile.addImportDeclaration({
		moduleSpecifier: "./dom",
		namedImports: ["ElementHandle"],
	});
	frameSelectorsSourceFile.addImportDeclaration({
		moduleSpecifier: "./chromium/crConnection",
		namedImports: ["CRSession"],
		isTypeOnly: true,
	});
	frameSelectorsSourceFile.addImportDeclaration({
		moduleSpecifier: "./progress",
		namedImports: ["Progress"],
		isTypeOnly: true,
	});
	frameSelectorsSourceFile.addImportDeclaration({
		moduleSpecifier: "./chromium/protocol",
		namedImports: ["Protocol"],
		isTypeOnly: true,
	});

	// ------- FrameSelectors Class -------
	const frameSelectorsClass = frameSelectorsSourceFile.getClassOrThrow("FrameSelectors");

	// -- queryArrayInMainWorld Method --
	const queryArrayInMainWorldMethod = frameSelectorsClass.getMethodOrThrow("queryArrayInMainWorld");
	queryArrayInMainWorldMethod.addParameter({
		name: "isolatedContext",
		type: "boolean",
		hasQuestionToken: true,
	});
	// Update mainWorld property based on isolatedContext parameter
	const resolveInjectedCall = queryArrayInMainWorldMethod
		.getDescendantsOfKind(SyntaxKind.CallExpression)
		.find(callExpr =>
			callExpr.getExpression().getText() === "this.resolveInjectedForSelector" &&
			callExpr.getArguments()[1]?.getKind() === SyntaxKind.ObjectLiteralExpression
		);
	const mainWorldProp = assertDefined(
		assertDefined(resolveInjectedCall)
			.getArguments()[1]
			.asKindOrThrow(SyntaxKind.ObjectLiteralExpression)
			.getProperty("mainWorld")
	);
	if (mainWorldProp.getText() === "mainWorld: true")
		mainWorldProp.replaceWithText("mainWorld: !isolatedContext");

	// -- resolveFrameForSelector Method --
	const resolveFrameForSelectorMethod = frameSelectorsClass.getMethodOrThrow("resolveFrameForSelector");
	// Change 'element' variable declaration from const to let to allow reassignment.
	assertDefined(
		resolveFrameForSelectorMethod
			.getDescendantsOfKind(SyntaxKind.VariableStatement)
			.find(s => s.getText().includes("const element = handle.asElement()"))
	).setDeclarationKind(VariableDeclarationKind.Let);
	// Handle the case when element is not found - fetch it from the document using the parsed selector
	const resolveFrameForSelectorIfStatement = resolveFrameForSelectorMethod
		.getDescendantsOfKind(SyntaxKind.IfStatement)
		.find(statement => statement.getExpression().getText() === "!element");
	assertDefined(resolveFrameForSelectorIfStatement).replaceWithText(`
		if (!element) {
			try {
				var client = frame._page.delegate._sessionForFrame(frame)._client;
			} catch (e) {
				var client = frame._page.delegate._mainFrameSession._client;
			}
			var mainContext = await frame._context("main");
			const documentNode = await client.send("Runtime.evaluate", {
				expression: "document",
				serializationOptions: { serialization: "idOnly" },
				contextId: mainContext.delegate._contextId
			});
			const documentScope = new ElementHandle(mainContext, documentNode.result.objectId);
				var check = await this._customFindFramesByParsed(injectedScript, client, mainContext, documentScope, undefined, info.parsed);
			if (check.length === 0) return null;
			element = check[0];
		}
	`);

		// -- resolveInjectedForSelector Method --
		const resolveInjectedForSelectorMethod = frameSelectorsClass.getMethodOrThrow("resolveInjectedForSelector");
		// Find the statement where 'injected' is assigned from 'context.injectedScript' and add a null check
		const contextStatement = assertDefined(resolveInjectedForSelectorMethod
			.getStatements()
			.find(stmt => {
				const varStmt = stmt.asKind(SyntaxKind.VariableStatement);
				if (!varStmt)
					return false;
				const decl = assertDefined(varStmt.getDeclarations()[0]);
				const callExpr = decl
					.getInitializerIfKind(SyntaxKind.AwaitExpression)
					?.getExpressionIfKind(SyntaxKind.CallExpression);
				if (!callExpr)
					return false;

				return decl.getName() === "context" && callExpr.getExpression().getText().includes("._context");
			}));
		resolveInjectedForSelectorMethod.insertStatements(contextStatement.getChildIndex() + 1, `if (!context) throw new Error("Frame was detached");`);


	// -- _customFindFramesByParsed Method -- progress
	frameSelectorsClass.addMethod({
		name: "_customFindFramesByParsed",
		isAsync: true,
		parameters: [
			{ name: "resolved", type: "JSHandle<InjectedScript>" },
			{ name: "client", type: "CRSession" },
			{ name: "context", type: "FrameExecutionContext" },
			{ name: "documentScope", type: "ElementHandle" },
			{ name: "progress", type: "Progress | undefined" },
			{ name: "parsed", type: "ParsedSelector" },
		],
	});
	const customFindFramesByParsedSelectorsMethod = frameSelectorsClass.getMethodOrThrow("_customFindFramesByParsed");
	customFindFramesByParsedSelectorsMethod.setBodyText(`
		var parsedEdits = { ...parsed };
		const callId = progress?.metadata.id;
		// Note: We start scoping at document level
		var currentScopingElements = [documentScope];

		for (const part of [...parsed.parts]) {
			parsedEdits.parts = [part];
			var elements = [];

			if (part.name === "nth") {
				const partNth = Number(part.body);
				// Check if any Elements are currently scoped, else return empty array to continue polling
				if (currentScopingElements.length == 0)
					return [];

				if (partNth > currentScopingElements.length-1 || partNth < -(currentScopingElements.length-1))
					if (parsed.capture !== undefined)
						throw new Error("Can't query n-th element in a request with the capture.");
					return [];
				currentScopingElements = [currentScopingElements.at(partNth)];
				continue;
			} else if (part.name === "internal:or") {
				var orredElements = await this._customFindFramesByParsed(resolved, client, context, documentScope, progress, part.body.parsed);
				elements = [...currentScopingElements, ...orredElements];
			} else if (part.name == "internal:and") {
				var andedElements = await this._customFindFramesByParsed(resolved, client, context, documentScope, progress, part.body.parsed);
				const backendNodeIds = new Set(andedElements.map(elem => elem.backendNodeId));
				elements = currentScopingElements.filter(elem => backendNodeIds.has(elem.backendNodeId));
			} else {
				for (const scope of currentScopingElements) {
					const describedScope = await client.send("DOM.describeNode", {
						objectId: scope._objectId,
						depth: -1,
						pierce: true
					});

					let findClosedShadowRoots = function(node, results = []) {
						if (!node || typeof node !== "object") return results;
						if (node.shadowRoots && Array.isArray(node.shadowRoots)) {
							for (const shadowRoot of node.shadowRoots) {
								if (shadowRoot.shadowRootType === "closed" && shadowRoot.backendNodeId) {
									results.push(shadowRoot.backendNodeId);
								}
								findClosedShadowRoots(shadowRoot, results);
							}
						}
						if (node.nodeName !== "IFRAME" && node.children && Array.isArray(node.children)) {
							for (const child of node.children) {
								findClosedShadowRoots(child, results);
							}
						}
						return results;
					};
					var shadowRootBackendIds = findClosedShadowRoots(describedScope.node);

					const shadowRoots = await Promise.all(
						shadowRootBackendIds.map(async backendNodeId => {
							const resolved = await client.send("DOM.resolveNode", {
								backendNodeId,
								contextId: context.delegate._contextId,
							});
							return new ElementHandle(context, resolved.object.objectId);
						})
					);

					// Elements Queryed in the "current round"
					const queryGroups: { handles: any; parentNode: any }[] = [];
					for (var shadowRoot of shadowRoots) {
						const shadowHandles = await shadowRoot.evaluateHandleInUtility(
							([injected, node, { parsed, callId }]) => {
							 	const elements = injected.querySelectorAll(parsed, node);
								if (callId)
									injected.markTargetElements(new Set(elements), callId);
								return elements;
							}, {
								parsed: parsedEdits,
								callId
							}
						);
						queryGroups.push({ handles: shadowHandles, parentNode: shadowRoot });
					}

					// Document Root Elements (not in CSR)
					const rootHandles = await scope.evaluateHandleInUtility(
						([injected, node, { parsed, callId }]) => {
						 	const elements = injected.querySelectorAll(parsed, node);
							if (callId)
								injected.markTargetElements(new Set(elements), callId);
							return elements;
						}, {
							parsed: parsedEdits,
							callId
						}
					);
					queryGroups.push({ handles: rootHandles, parentNode: scope });

					// Querying and Sorting the elements by their backendNodeId
					for (const { handles, parentNode } of queryGroups) {
						const handlesAmount = await (await handles.getProperty("length")).jsonValue();
						for (var i = 0; i < handlesAmount; i++) {
						  if (parentNode instanceof ElementHandle) {
								var element = await parentNode.evaluateHandleInUtility(
									([injected, node, { i, handles: elems }]) => elems[i],
									{ i, handles }
								);
							} else {
								var element = await parentNode.evaluateHandle(
									(injected, { i, handles: elems }) => elems[i],
									{ i, handles }
								);
							}

							// For other Functions/Utilities
							element.parentNode = parentNode;
							const resolvedElement = await client.send("DOM.describeNode", { objectId: element._objectId, depth: -1 });
							element.backendNodeId = resolvedElement.node.backendNodeId;
							element.nodePosition = await this._findElementPositionInDomTree(element, describedScope.node, context, "");
							elements.push(element);
						}
					}
				}
			}

			// Sorting elements by their nodePosition, which is a index to the Element in the DOM tree
			const getParts = (pos) => (pos || '').split('.').filter(Boolean).map(Number);
			elements.sort((a, b) => {
				const partsA = getParts(a.nodePosition);
				const partsB = getParts(b.nodePosition);

				for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
					const diff = (partsA[i] ?? -1) - (partsB[i] ?? -1);
					if (diff !== 0) return diff;
				}
				return 0;
			});

			// Remove duplicates by backendNodeId, keeping the first occurrence
			currentScopingElements = Array.from(
				new Map(elements.map(e => [e.backendNodeId, e])).values()
			);
		}

		return currentScopingElements;
	`);

	// -- _findElementPositionInDomTree Method --
	frameSelectorsClass.addMethod({
		name: "_findElementPositionInDomTree",
		isAsync: true,
		parameters: [
			{ name: "element", type: "{ backendNodeId: number }" },
			{ name: "queryingElement", type: "Protocol.DOM.Node" },
			{ name: "context", type: "FrameExecutionContext" },
			{ name: "currentIndex", type: "string" },
		],
	});
	const findElementPositionInDomTreeMethod = frameSelectorsClass.getMethodOrThrow("_findElementPositionInDomTree");
	findElementPositionInDomTreeMethod.setBodyText(`
		// Get Element Position in DOM Tree by Indexing it via their children indexes, like a search tree index
		// Check if backendNodeId matches, if so, return currentIndex
		if (element.backendNodeId === queryingElement.backendNodeId)
			return currentIndex;

		// Iterating through children of queryingElement
		for (const [childrenNodeIndex, child] of (queryingElement.children || []).entries()) {
			// Further querying the child recursively and appending the children index to the currentIndex
			const childIndex = await this._findElementPositionInDomTree(element, child, context, currentIndex + "." + childrenNodeIndex.toString());
			if (childIndex !== null) return childIndex;
		}

		for (const shadowRoot of queryingElement.shadowRoots || []) {
			// For CSRs, we dont have to append its index because patchright treats CSRs like they dont exist
			if (shadowRoot.shadowRootType === "closed" && shadowRoot.backendNodeId) {
				// Resolve the CDP client for the current context so closed shadow roots can be traversed safely.
				const client = context.frame._page.delegate._sessionForFrame(context.frame)._client;
				const describedShadowRoot = await client.send("DOM.describeNode", { backendNodeId: shadowRoot.backendNodeId, depth: -1, pierce: true });
				if (describedShadowRoot && describedShadowRoot.node) {
					const childIndex = await this._findElementPositionInDomTree(element, describedShadowRoot.node, context, currentIndex);
					if (childIndex !== null) return childIndex;
				}
			}
			// Traverse into shadow root children (open and closed) to properly position elements inside shadow DOMs
			for (const [shadowChildIndex, shadowChild] of (shadowRoot.children || []).entries()) {
				const childIndex = await this._findElementPositionInDomTree(element, shadowChild, context, currentIndex + "." + shadowChildIndex.toString());
				if (childIndex !== null) return childIndex;
			}
		}
		return null;
	`);
}