import { type Project, SyntaxKind, VariableDeclarationKind } from "ts-morph";
import { shadowPiercingQueryBody } from "./shadowPiercingQuery.ts";
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
		namedImports: ["Progress", "nullProgress"],
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
	if (!queryArrayInMainWorldMethod.getParameter("isolatedContext"))
		queryArrayInMainWorldMethod.addParameter({
			name: "isolatedContext",
			type: "boolean",
			hasQuestionToken: true,
		});
	// Update mainWorld property based on isolatedContext parameter
	const resolveInjectedCall = queryArrayInMainWorldMethod
		.getDescendantsOfKind(SyntaxKind.CallExpression)
		.find(
			callExpr =>
				callExpr.getExpression().getText() === "this.resolveInjectedForSelector" &&
				callExpr.getArguments()[1]?.getKind() === SyntaxKind.ObjectLiteralExpression,
		);
	const mainWorldProp = assertDefined(
		assertDefined(resolveInjectedCall)
			.getArguments()[1]
			.asKindOrThrow(SyntaxKind.ObjectLiteralExpression)
			.getProperty("mainWorld"),
	);
	if (mainWorldProp.getText() === "mainWorld: true") mainWorldProp.replaceWithText("mainWorld: !isolatedContext");

	// -- resolveFrameForSelector Method --
	const resolveFrameForSelectorMethod = frameSelectorsClass.getMethodOrThrow("resolveFrameForSelector");
	// Change 'element' variable declaration from const to let to allow reassignment.
	resolveFrameForSelectorMethod
		.getDescendantsOfKind(SyntaxKind.VariableStatement)
		.find(s => s.getText().includes("const element = handle.asElement()"))
		?.setDeclarationKind(VariableDeclarationKind.Let);
	// Handle the case when element is not found - fetch it from the document using the parsed selector
	const resolveFrameForSelectorIfStatement = resolveFrameForSelectorMethod
		.getDescendantsOfKind(SyntaxKind.IfStatement)
		.find(statement => statement.getExpression().getText() === "!element");
	if (resolveFrameForSelectorIfStatement)
		resolveFrameForSelectorIfStatement.replaceWithText(`
			if (!element) {
				if ((options as any).state === "hidden" || (options as any).state === "detached")
					return null;
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
	if (!resolveFrameForSelectorMethod.getText().includes("const isConnected = await element.evaluateInUtility")) {
		const maybeFrameStatement = assertDefined(
			resolveFrameForSelectorMethod
				.getDescendantsOfKind(SyntaxKind.VariableStatement)
				.find(statement =>
					statement.getText().includes("const maybeFrame = await frame._page.delegate.getContentFrame(element)"),
				),
		);
		const parentBlock = maybeFrameStatement.getParentIfKindOrThrow(SyntaxKind.Block);
		parentBlock.insertStatements(
			maybeFrameStatement.getChildIndex(),
			`
			const isConnected = await element.evaluateInUtility(([injected, node]) => node.isConnected, {}).catch(() => false);
			if (!isConnected) {
				element.dispose();
				return null;
			}
			`,
		);
	}

	// -- resolveInjectedForSelector Method --
	const resolveInjectedForSelectorMethod = frameSelectorsClass.getMethodOrThrow("resolveInjectedForSelector");
	// Find the statement where 'injected' is assigned from 'context.injectedScript' and add a null check
	const contextStatement = assertDefined(
		resolveInjectedForSelectorMethod.getStatements().find(stmt => {
			const varStmt = stmt.asKind(SyntaxKind.VariableStatement);
			if (!varStmt) return false;
			const decl = assertDefined(varStmt.getDeclarations()[0]);
			const callExpr = decl
				.getInitializerIfKind(SyntaxKind.AwaitExpression)
				?.getExpressionIfKind(SyntaxKind.CallExpression);
			if (!callExpr) return false;

			const expressionText = callExpr.getExpression().getText();
			return (
				decl.getName() === "context" && (expressionText.includes("._context") || expressionText.includes(".context"))
			);
		}),
	);
	if (!resolveInjectedForSelectorMethod.getText().includes('if (!context) throw new Error("Frame was detached");'))
		resolveInjectedForSelectorMethod.insertStatements(
			contextStatement.getChildIndex() + 1,
			`if (!context) throw new Error("Frame was detached");`,
		);

	// -- _customFindFramesByParsed Method -- progress
	if (!frameSelectorsClass.getMethod("_customFindFramesByParsed"))
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
	customFindFramesByParsedSelectorsMethod.setBodyText(
		shadowPiercingQueryBody({
			methodName: "_customFindFramesByParsed",
			elementHandle: "ElementHandle",
			callIdArgument: "callId",
			positionFinderReceiver: "this",
			prelude: "const callId = progress?.metadata.id;",
		}),
	);

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
