import { Project, SyntaxKind } from "ts-morph";

// ----------------------------
// server/frameSelectors.ts
// ----------------------------
export function patchFrameSelectors(project) {
  // Add source file to the project
  const frameSelectorsSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/frameSelectors.ts");
  // Add the custom import and comment at the start of the file
  frameSelectorsSourceFile.insertStatements(0, [
    "// patchright - custom imports",
    "import { ElementHandle } from './dom';",
    "",
  ]);

  // ------- FrameSelectors Class -------
  const frameSelectorsClass = frameSelectorsSourceFile.getClass("FrameSelectors");

  // -- queryArrayInMainWorld Method --
  const queryArrayInMainWorldMethod = frameSelectorsClass.getMethod("queryArrayInMainWorld");
  queryArrayInMainWorldMethod.addParameter({
    name: "isolatedContext",
    type: "boolean",
    hasQuestionToken: true,
  });
  const queryArrayInMainWorldMethodCalls = queryArrayInMainWorldMethod.getDescendantsOfKind(SyntaxKind.CallExpression);
  for (const callExpr of queryArrayInMainWorldMethodCalls) {
    const exprText = callExpr.getExpression().getText();
    if (exprText === "this.resolveInjectedForSelector") {
      const args = callExpr.getArguments();
      if (args.length > 1 && args[1].getKind() === SyntaxKind.ObjectLiteralExpression) {
        const objLiteral = args[1];

        const mainWorldProp = objLiteral.getProperty("mainWorld");
        if (mainWorldProp && mainWorldProp.getText() === "mainWorld: true") {
          mainWorldProp.replaceWithText("mainWorld: !isolatedContext");
          break;
        }
      }
    }
  }

  // -- resolveFrameForSelector Method --
  const resolveFrameForSelectorMethod = frameSelectorsClass.getMethod("resolveFrameForSelector");
  const constElementDeclaration = resolveFrameForSelectorMethod.getDescendantsOfKind(SyntaxKind.VariableStatement)
    .find(declaration => declaration.getText().includes("const element = handle.asElement()"));
  constElementDeclaration.setDeclarationKind("let");

  const resolveFrameForSelectorIfStatement = resolveFrameForSelectorMethod.getDescendantsOfKind(SyntaxKind.IfStatement).find(statement => statement.getExpression().getText() === "!element" && statement.getThenStatement().getText() === "return null;");
  resolveFrameForSelectorIfStatement.replaceWithText(`
      if (!element) {
        try {
          var client = frame._page.delegate._sessionForFrame(frame)._client;
        } catch (e) {
          var client = frame._page.delegate._mainFrameSession._client;
        }
        var mainContext = await frame._context("main");
        const documentNode = await client.send("Runtime.evaluate", {
          expression: "document",
          serializationOptions: {
            serialization: "idOnly"
          },
          contextId: mainContext.delegate._contextId
        });
        const documentScope = new ElementHandle(mainContext, documentNode.result.objectId);
        var check = await this._customFindFramesByParsed(injectedScript, client, mainContext, documentScope, info.parsed);
        if (check.length > 0) {
          element = check[0];
        } else {
          return null;
        }
      }
    `);

  // -- _customFindFramesByParsed Method --
  frameSelectorsClass.addMethod({
    name: "_customFindFramesByParsed",
    isAsync: true,
    parameters: [
      { name: "injected" },
      { name: "client" },
      { name: "context" },
      { name: "documentScope" },
      { name: "parsed" },
    ],
  });
  const customFindFramesByParsedSelectorsMethod = frameSelectorsClass.getMethod("_customFindFramesByParsed");
  customFindFramesByParsedSelectorsMethod.setBodyText(`
      var parsedEdits = { ...parsed };
      var currentScopingElements = [documentScope];
      while (parsed.parts.length > 0) {
        var part = parsed.parts.shift();
        parsedEdits.parts = [part];
        var elements = [];
        var elementsIndexes = [];
        if (part.name == "nth") {
          const partNth = Number(part.body);
          if (partNth > currentScopingElements.length || partNth < -currentScopingElements.length) {
            return continuePolling;
          } else {
            currentScopingElements = [currentScopingElements.at(partNth)];
            continue;
          }
        } else if (part.name == "internal:or") {
          var orredElements = await this._customFindFramesByParsed(injected, client, context, documentScope, part.body.parsed);
          elements = currentScopingElements.concat(orredElements);
        } else if (part.name == "internal:and") {
          var andedElements = await this._customFindFramesByParsed(injected, client, context, documentScope, part.body.parsed);
          const backendNodeIds = new Set(andedElements.map((item) => item.backendNodeId));
          elements = currentScopingElements.filter((item) => backendNodeIds.has(item.backendNodeId));
        } else {
          for (const scope of currentScopingElements) {
            const describedScope = await client.send("DOM.describeNode", {
              objectId: scope._objectId,
              depth: -1,
              pierce: true
            });
            var queryingElements = [];
            let findClosedShadowRoots2 = function(node, results = []) {
              if (!node || typeof node !== "object") return results;
              if (node.shadowRoots && Array.isArray(node.shadowRoots)) {
                for (const shadowRoot2 of node.shadowRoots) {
                  if (shadowRoot2.shadowRootType === "closed" && shadowRoot2.backendNodeId) {
                    results.push(shadowRoot2.backendNodeId);
                  }
                  findClosedShadowRoots2(shadowRoot2, results);
                }
              }
              if (node.nodeName !== "IFRAME" && node.children && Array.isArray(node.children)) {
                for (const child of node.children) {
                  findClosedShadowRoots2(child, results);
                }
              }
              return results;
            };
            var findClosedShadowRoots = findClosedShadowRoots2;
            var shadowRootBackendIds = findClosedShadowRoots2(describedScope.node);
            var shadowRoots = [];
            for (var shadowRootBackendId of shadowRootBackendIds) {
              var resolvedShadowRoot = await client.send("DOM.resolveNode", {
                backendNodeId: shadowRootBackendId,
                contextId: context.delegate._contextId
              });
              shadowRoots.push(new ElementHandle(context, resolvedShadowRoot.object.objectId));
            }
            for (var shadowRoot of shadowRoots) {
              const shadowElements = await shadowRoot.evaluateHandleInUtility(([injected, node, { parsed: parsed2 }]) => {
                const elements2 = injected.querySelectorAll(parsed2, node);
                return elements2;
              }, {
                parsed: parsedEdits,
              });
              const shadowElementsAmount = await shadowElements.getProperty("length");
              queryingElements.push([shadowElements, shadowElementsAmount, shadowRoot]);
            }
            const rootElements = await scope.evaluateHandleInUtility(([injected, node, { parsed: parsed2 }]) => {
              const elements2 = injected.querySelectorAll(parsed2, node);
              return elements2;
            }, {
              parsed: parsedEdits
            });
            const rootElementsAmount = await rootElements.getProperty("length");
            queryingElements.push([rootElements, rootElementsAmount, injected]);
            for (var queryedElement of queryingElements) {
              var elementsToCheck = queryedElement[0];
              var elementsAmount = await queryedElement[1].jsonValue();
              var parentNode = queryedElement[2];
              for (var i = 0; i < elementsAmount; i++) {
                if (parentNode.constructor.name == "ElementHandle") {
                  var elementToCheck = await parentNode.evaluateHandleInUtility(([injected, node, { index, elementsToCheck: elementsToCheck2 }]) => {
                    return elementsToCheck2[index];
                  }, { index: i, elementsToCheck });
                } else {
                  var elementToCheck = await parentNode.evaluateHandle((injected, { index, elementsToCheck: elementsToCheck2 }) => {
                    return elementsToCheck2[index];
                  }, { index: i, elementsToCheck });
                }
                elementToCheck.parentNode = parentNode;
                var resolvedElement = await client.send("DOM.describeNode", {
                  objectId: elementToCheck._objectId,
                  depth: -1
                });
                elementToCheck.backendNodeId = resolvedElement.node.backendNodeId;
                elementToCheck.nodePosition = this._findElementPositionInDomTree(elementToCheck, describedScope.node, context, "");
                elements.push(elementToCheck);
              }
            }
          }
        }
        // Sorting elements by their nodePosition, which is a index to the Element in the DOM tree
        const getParts = (pos) => (pos ? pos.split('.').filter(p => p !== "").map(Number) : []);
        elements.sort((a, b) => {
          const partA = getParts(a.nodePosition);
          const partB = getParts(b.nodePosition);
          const maxLength = Math.max(partA.length, partB.length);

          for (let i = 0; i < maxLength; i++) {
            const aVal = partA[i] ?? -1;
            const bVal = partB[i] ?? -1;
            if (aVal !== bVal) return aVal - bVal;
          }
          return 0;
        });

        // Remove duplicates by nodePosition, keeping the first occurrence
        currentScopingElements = Array.from(
          new Map(elements.map(e => [e.nodePosition, e])).values()
        );
      }
      return currentScopingElements;
    `);

  // -- _findElementPositionInDomTree Method --
  frameSelectorsClass.addMethod({
    name: "_findElementPositionInDomTree",
    isAsync: false,
    parameters: [
      { name: "element" },
      { name: "queryingElement" },
      { name: "documentScope" },
      { name: "currentIndex" },
    ],
  });
  const findElementPositionInDomTreeMethod = frameSelectorsClass.getMethod("_findElementPositionInDomTree");
  findElementPositionInDomTreeMethod.setBodyText(`
      // Get Element Position in DOM Tree by Indexing it via their children indexes, like a search tree index
      // Check if backendNodeId matches, if so, return currentIndex
      if (element.backendNodeId === queryingElement.backendNodeId) {
        return currentIndex;
      }
      // Iterating through children of queryingElement
      for (const child of queryingElement.children || []) {
        // Getting index of child in queryingElement's children
        const childrenNodeIndex = queryingElement.children.indexOf(child);
        // Further querying the child recursively and appending the children index to the currentIndex
        const childIndex = this._findElementPositionInDomTree(element, child, documentScope, currentIndex + "." + childrenNodeIndex.toString());
        if (childIndex !== null) return childIndex;
      }
      if (queryingElement.shadowRoots && Array.isArray(queryingElement.shadowRoots)) {
        // Basically same for CSRs, but we dont have to append its index because patchright treats CSRs like they dont exist
        for (const shadowRoot of queryingElement.shadowRoots) {
          if (shadowRoot.shadowRootType === "closed" && shadowRoot.backendNodeId) {
            const shadowRootHandle = new ElementHandle(documentScope, shadowRoot.backendNodeId);
            const childIndex = this._findElementPositionInDomTree(element, shadowRootHandle, documentScope, currentIndex);
            if (childIndex !== null) return childIndex;
          }
        }
      }
      return null;
    `);
}