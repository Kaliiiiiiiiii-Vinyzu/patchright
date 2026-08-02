/** Recursion target, e.g. `_customFindFramesByParsed`. */
type QueryMethodName = `_customFind${string}ByParsed`;
/** `ElementHandle` as reachable from the patched module, e.g. `dom.ElementHandle`. */
type ElementHandleRef = `${string}ElementHandle`;
/** Object-literal entry for the injected call id, shorthand or explicit. */
type CallIdArgument = "callId" | `callId: ${string}`;
/** Receiver owning `_findElementPositionInDomTree`, e.g. `this.selectors`. */
type PositionFinderReceiver = `this${string}`;

/**
 * How the shared selector body binds into a given patched module. The string
 * options are shaped so a typo fails to compile rather than emitting injected
 * code that only breaks in the browser.
 */
export interface ShadowPiercingQueryOptions {
	/** Method the body recurses into for `internal:or` / `internal:and` parts. */
	methodName: QueryMethodName;
	/** How `ElementHandle` is reachable from the patched module's scope. */
	elementHandle: ElementHandleRef;
	/** Expression passed to the injected script as the call id. */
	callIdArgument: CallIdArgument;
	/** Receiver owning `_findElementPositionInDomTree`. */
	positionFinderReceiver: PositionFinderReceiver;
	/** Statement emitted before the scoping loop. */
	prelude?: string;
}

/**
 * Shared body of `FrameSelectors._customFindFramesByParsed` and
 * `Frame._customFindElementsByParsed`.
 *
 * Walks a parsed selector part by part, pierces closed shadow roots via
 * `DOM.describeNode`, queries every root plus the light DOM, then orders and
 * dedupes hits by backendNodeId. Both call sites need identical traversal, so
 * they share one source of truth and differ only through the options above.
 */
export function shadowPiercingQueryBody(options: ShadowPiercingQueryOptions): string {
	const { methodName, elementHandle, callIdArgument, positionFinderReceiver, prelude } = options;
	const preludeText = prelude ? "\n\t\t" + prelude : "";
	return `
		var parsedEdits = { ...parsed };${preludeText}
		progress = progress || nullProgress;
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

				if (partNth > currentScopingElements.length-1 || partNth < -(currentScopingElements.length-1)) {
					if (parsed.capture !== undefined)
						throw new Error("Can't query n-th element in a request with the capture.");
					return [];
				}
				currentScopingElements = [currentScopingElements.at(partNth)];
				continue;
			} else if (part.name === "internal:or") {
				var orredElements = await this.${methodName}(resolved, client, context, documentScope, progress, part.body.parsed);
				elements = [...currentScopingElements, ...orredElements];
			} else if (part.name == "internal:and") {
				var andedElements = await this.${methodName}(resolved, client, context, documentScope, progress, part.body.parsed);
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
							return new ${elementHandle}(context, resolved.object.objectId);
						})
					);

					// Elements Queryed in the "current round"
					const queryGroups: { handles: any; parentNode: any }[] = [];
					for (var shadowRoot of shadowRoots) {
						const shadowHandles = await (shadowRoot as any)._evaluateHandleInUtility(
							([injected, node, { parsed, callId }]) => {
							 	const elements = injected.querySelectorAll(parsed, node);
								if (callId)
									injected.markTargetElements(new Set(elements), callId);
								return elements;
							}, {
								parsed: parsedEdits,
								${callIdArgument}
							}
						);
						queryGroups.push({ handles: shadowHandles, parentNode: shadowRoot });
					}

					// Document Root Elements (not in CSR)
					const rootHandles = await (scope as any)._evaluateHandleInUtility(
						([injected, node, { parsed, callId }]) => {
						 	const elements = injected.querySelectorAll(parsed, node);
							if (callId)
								injected.markTargetElements(new Set(elements), callId);
							return elements;
						}, {
							parsed: parsedEdits,
							${callIdArgument}
						}
					);
					queryGroups.push({ handles: rootHandles, parentNode: scope });

					// Querying and Sorting the elements by their backendNodeId
					for (const { handles, parentNode } of queryGroups) {
						const handlesAmount = await (await handles.getProperty(progress, "length")).jsonValue(progress);
						for (var i = 0; i < handlesAmount; i++) {
							let element;
						  if (parentNode instanceof ${elementHandle}) {
								element = await (parentNode as any)._evaluateHandleInUtility(
									([injected, node, { i, handles: elems }]) => elems[i],
									{ i, handles }
								);
							} else {
								element = await parentNode.evaluateHandle(
									(injected, { i, handles: elems }) => elems[i],
									{ i, handles }
								);
							}

							// For other Functions/Utilities
							element.parentNode = parentNode;
							const resolvedElement = await client.send("DOM.describeNode", { objectId: element._objectId, depth: -1 });
							element.backendNodeId = resolvedElement.node.backendNodeId;
							element.nodePosition = await ${positionFinderReceiver}._findElementPositionInDomTree(element, describedScope.node, context, "");
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
	`;
}
