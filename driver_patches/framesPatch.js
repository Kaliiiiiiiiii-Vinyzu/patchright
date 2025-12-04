import { Project, SyntaxKind } from "ts-morph";

// ----------------------------
// server/frames.ts
// ----------------------------
export function patchFrames(project) {
    // Add source file to the project
    const framesSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/frames.ts");
    // Add the custom import and comment at the start of the file
    framesSourceFile.insertStatements(0, [
      "// patchright - custom imports",
      "import { CRExecutionContext } from './chromium/crExecutionContext';",
      "import { FrameExecutionContext } from './dom';",
      "import crypto from 'crypto';",
      "",
    ]);

    // ------- FrameManager Class -------
    const frameManagerClass = framesSourceFile.getClass("FrameManager");
    // -- frameCommittedNewDocumentNavigation Method --
    const frameCommittedNewDocumentNavigationMethod = frameManagerClass.getMethod("frameCommittedNewDocumentNavigation")
    const clearLifecycleStatementIndex = frameCommittedNewDocumentNavigationMethod
        .getDescendantsOfKind(SyntaxKind.ExpressionStatement)
        .findIndex(stmt => stmt.getText().trim() === "frame._onClearLifecycle();");
    frameCommittedNewDocumentNavigationMethod.insertStatements(clearLifecycleStatementIndex - 2, [
      "this._iframeWorld = undefined;",
      "this._mainWorld = undefined;",
      "this._isolatedWorld = undefined;"
    ]);

    // ------- Frame Class -------
    const frameClass = framesSourceFile.getClass("Frame");
    // Add Properties to the Frame Class
    frameClass.addProperty({
      name: "_isolatedWorld",
      type: "dom.FrameExecutionContext",
    });
    frameClass.addProperty({
      name: "_mainWorld",
      type: "dom.FrameExecutionContext",
    });
    frameClass.addProperty({
      name: "_iframeWorld",
      type: "dom.FrameExecutionContext",
    });

    // -- evalOnSelector Method --
    const evalOnSelectorMethod = frameClass.getMethod("evalOnSelector");
    evalOnSelectorMethod.setBodyText(`const handle = await this.selectors.query(selector, { strict }, scope);
        if (!handle)
          throw new Error('Failed to find element matching selector "' + selector + '"');
        const result = await handle.evaluateExpression(expression, { isFunction }, arg, true);
        handle.dispose();
        return result;`)

    // -- evalOnSelectorAll Method --
    const evalOnSelectorAllMethod = frameClass.getMethod("evalOnSelectorAll");
    evalOnSelectorAllMethod.addParameter({
        name: "isolatedContext",
        type: "boolean",
        hasQuestionToken: true,
    });
    evalOnSelectorAllMethod.setBodyText(`
      try {
        isolatedContext = this.selectors._parseSelector(selector, { strict: false }).world !== "main" && isolatedContext;
        const arrayHandle = await this.selectors.queryArrayInMainWorld(selector, scope, isolatedContext);
        const result = await arrayHandle.evaluateExpression(expression, { isFunction }, arg, isolatedContext);
        arrayHandle.dispose();
        return result;
      } catch (e) {
        // Do i look like i know whats going on here?
        if ("JSHandles can be evaluated only in the context they were created!" === e.message) return await this.evalOnSelectorAll(selector, expression, isFunction, arg, scope, isolatedContext);
        throw e;
      }
    `);

    // -- querySelectorAll Method --
    const querySelectorAllMethod = frameClass.getMethod("querySelectorAll");
    querySelectorAllMethod.setBodyText(`
      const metadata = { internal: false, log: [], method: "querySelectorAll" };
      const progress = {
        log: message => metadata.log.push(message),
        metadata,
        race: (promise) => Promise.race(Array.isArray(promise) ? promise : [promise])
      }
      return await this._retryWithoutProgress(progress, selector, null, false, async (result) => {
        if (!result || !result[0]) return [];
        return result[1];
      }, 'returnAll', null);
    `);

    // -- querySelector Method --
    const querySelectorMethod = frameClass.getMethod("querySelector");
    querySelectorMethod.setBodyText(`
      return this.querySelectorAll(selector, options).then((handles) => {
        if (handles.length === 0)
          return null;
        if (handles.length > 1 && options?.strict)
          throw new Error(\`Strict mode: expected one element matching selector "\${selector}", found \${handles.length}\`);
        return handles[0];
      });
    `);

    // -- _getFrameMainFrameContextId Method --
    // Define the getFrameMainFrameContextIdCode
    /*const getFrameMainFrameContextIdCode = `var globalDocument = await client._sendMayFail('DOM.getFrameOwner', { frameId: this._id });
      if (globalDocument && globalDocument.nodeId) {
        for (const executionContextId of this._page.delegate._sessionForFrame(this)._parsedExecutionContextIds) {
          var documentObj = await client._sendMayFail("DOM.resolveNode", { nodeId: globalDocument.nodeId });
          if (documentObj) {
            var globalThis = await client._sendMayFail('Runtime.evaluate', {
              expression: "document",
              serializationOptions: { serialization: "idOnly" },
              contextId: executionContextId
            });
            if (globalThis) {
              var globalThisObjId = globalThis["result"]['objectId'];
              var requestedNode = await client.send("DOM.requestNode", { objectId: globalThisObjId });
              var node = await client._sendMayFail("DOM.describeNode", { nodeId: requestedNode.nodeId, pierce: true, depth: 10 });
              if (node && node.node.documentURL == this._url) {
                var node0 = await client._sendMayFail("DOM.resolveNode", { nodeId: requestedNode.nodeId });
                if (node0 && (node.node.nodeId - 1 == globalDocument.nodeId)) { // && (node.node.backendNodeId + 1 == globalDocument.backendNodeId)
                  var _executionContextId = parseInt(node0.object.objectId.split('.')[1], 10);
                  return _executionContextId;
                }
              }
            }
          }
        }
      }
      return 0;`;*/

    // Add the method to the class
    frameClass.addMethod({
      name: "_getFrameMainFrameContextId",
      isAsync: true,
      parameters: [
        { name: "client" },
      ],
      returnType: "Promise<number>",
    });
    const getFrameMainFrameContextIdMethod = frameClass.getMethod("_getFrameMainFrameContextId",);
    getFrameMainFrameContextIdMethod.setBodyText(`
      try {
        var globalDocument = await client._sendMayFail("DOM.getFrameOwner", {frameId: this._id,});
        if (globalDocument && globalDocument.nodeId) {
          var describedNode = await client._sendMayFail("DOM.describeNode", {
            backendNodeId: globalDocument.backendNodeId,
          });
          if (describedNode) {
            var resolvedNode = await client._sendMayFail("DOM.resolveNode", {
              nodeId: describedNode.node.contentDocument.nodeId,
            });
            var _executionContextId = parseInt(resolvedNode.object.objectId.split(".")[1], 10);
            return _executionContextId;
          }
        }
      } catch (e) {}
      return 0;
    `);

    // -- _context Method --
    const contextMethod = frameClass.getMethod("_context");
    contextMethod.setIsAsync(true);
    contextMethod.setBodyText(`
      /* await this._page.delegate._mainFrameSession._client._sendMayFail('DOM.enable');
      var globalDoc = await this._page.delegate._mainFrameSession._client._sendMayFail('DOM.getFrameOwner', { frameId: this._id });
      if (globalDoc) {
        await this._page.delegate._mainFrameSession._client._sendMayFail("DOM.resolveNode", { nodeId: globalDoc.nodeId })
      } */

      if (this.isDetached()) throw new Error('Frame was detached');
      try {
        var client = this._page.delegate._sessionForFrame(this)._client
      } catch (e) { var client = this._page.delegate._mainFrameSession._client }
      var iframeExecutionContextId = await this._getFrameMainFrameContextId(client)

      if (world == "main") {
        // Iframe Only
        if (this != this._page.mainFrame() && iframeExecutionContextId && this._iframeWorld == undefined) {
          var executionContextId = iframeExecutionContextId
          var crContext = new CRExecutionContext(client, { id: executionContextId }, this._id)
          this._iframeWorld = new FrameExecutionContext(crContext, this, world)
          this._page.delegate._mainFrameSession._onExecutionContextCreated({
            id: executionContextId, origin: world, name: world, auxData: { isDefault: this === this._page.mainFrame(), type: 'isolated', frameId: this._id }
          })
        } else if (this._mainWorld == undefined) {
          var globalThis = await client._sendMayFail('Runtime.evaluate', {
            expression: "globalThis",
            serializationOptions: { serialization: "idOnly" }
          });
          if (!globalThis) { return }
          var globalThisObjId = globalThis["result"]['objectId']
          var executionContextId = parseInt(globalThisObjId.split('.')[1], 10);

          var crContext = new CRExecutionContext(client, { id: executionContextId }, this._id)
          this._mainWorld = new FrameExecutionContext(crContext, this, world)
          this._page.delegate._mainFrameSession._onExecutionContextCreated({
            id: executionContextId, origin: world, name: world, auxData: { isDefault: this === this._page.mainFrame(), type: 'isolated', frameId: this._id }
          })
        }
      }
      if (world != "main" && this._isolatedWorld == undefined) {
        world = "utility"
        var result = await client._sendMayFail('Page.createIsolatedWorld', {
          frameId: this._id, grantUniveralAccess: true, worldName: world
        });
        if (!result) {
          // if (this.isDetached()) throw new Error("Frame was detached");
          return
        }
        var executionContextId = result.executionContextId
        var crContext = new CRExecutionContext(client, { id: executionContextId }, this._id)
        this._isolatedWorld = new FrameExecutionContext(crContext, this, world)
        this._page.delegate._mainFrameSession._onExecutionContextCreated({
          id: executionContextId, origin: world, name: world, auxData: { isDefault: this === this._page.mainFrame(), type: 'isolated', frameId: this._id }
        })
      }

      if (world != "main") {
        return this._isolatedWorld;
      } else if (this != this._page.mainFrame() && iframeExecutionContextId) {
        return this._iframeWorld;
      } else {
        return this._mainWorld;
      }`)

    // -- _setContext Method --
    const setContentMethod = frameClass.getMethod("setContent");
    // Locate the existing line of code
    setContentMethod.setBodyText(`
      await this.raceNavigationAction(progress, async () => {
        const waitUntil = options.waitUntil === void 0 ? "load" : options.waitUntil;
        progress.log(\`setting frame content, waiting until "\${waitUntil}"\`);
        const lifecyclePromise = new Promise((resolve, reject) => {
          this._onClearLifecycle();
          this._waitForLoadState(progress, waitUntil).then(resolve).catch(reject);
        });
        const setContentPromise = this._page.delegate._mainFrameSession._client.send("Page.setDocumentContent", {
          frameId: this._id,
          html
        });
        await Promise.all([setContentPromise, lifecyclePromise]);

        return null;
      });
    `);

    // -- _retryWithProgressIfNotConnected Method --
    const retryWithProgressIfNotConnectedMethod = frameClass.getMethod("_retryWithProgressIfNotConnected");
    retryWithProgressIfNotConnectedMethod.addParameter({
        name: "returnAction",
        type: "boolean | undefined",
    });
    retryWithProgressIfNotConnectedMethod.setBodyText(`
      progress.log("waiting for " + this._asLocator(selector));
      return this.retryWithProgressAndTimeouts(progress, [0, 20, 50, 100, 100, 500], async continuePolling => {
        return this._retryWithoutProgress(progress, selector, strict, performActionPreChecks, action, returnAction, continuePolling);
      });
    `);

    // -- _retryWithoutProgress Method --
    frameClass.addMethod({
      name: "_retryWithoutProgress",
      isAsync: true,
      parameters: [
        { name: "progress" },
        { name: "selector" },
        { name: "strict" },
        { name: "performActionPreChecks" },
        { name: "action" },
        { name: "returnAction" },
        { name: "continuePolling" },
      ],
    });
    const customRetryWithoutProgressMethod = frameClass.getMethod("_retryWithoutProgress");
    customRetryWithoutProgressMethod.setBodyText(`
      if (performActionPreChecks) await this._page.performActionPreChecks(progress);
      const resolved = await this.selectors.resolveInjectedForSelector(selector, { strict });
      if (!resolved) {
        if (returnAction === 'returnOnNotResolved' || returnAction === 'returnAll') {
          const result = await action(null);
          return result === "internal:continuepolling" ? continuePolling : result;
        }
        return continuePolling;
      }

      try {
        var client = this._page.delegate._sessionForFrame(resolved.frame)._client;
      } catch (e) {
        var client = this._page.delegate._mainFrameSession._client;
      }
      var utilityContext = await resolved.frame._utilityContext();
      var mainContext = await resolved.frame._mainContext();
      const documentNode = await client._sendMayFail('Runtime.evaluate', {
        expression: "document",
        serializationOptions: {
          serialization: "idOnly"
        },
        contextId: utilityContext.delegate._contextId,
      });
      if (!documentNode) return continuePolling;
      const documentScope = new dom.ElementHandle(utilityContext, documentNode.result.objectId);

      let currentScopingElements;
      try {
        currentScopingElements = await this._customFindElementsByParsed(resolved, client, mainContext, documentScope, progress, resolved.info.parsed);
      } catch (e) {
        if ("JSHandles can be evaluated only in the context they were created!" === e.message) return continuePolling3;
        await progress.race(resolved.injected.evaluateHandle((injected, { error }) => { throw error }, { error: e }));
      }

      if (currentScopingElements.length == 0) {
        // TODO: Dispose?
        if (returnAction === 'returnOnNotResolved' || returnAction === 'returnAll') {
        const result = await action(null);
        return result === "internal:continuepolling" ? continuePolling2 : result;
      }
        return continuePolling;
      }
      const resultElement = currentScopingElements[0];
      if (currentScopingElements.length > 1) {
        if (resolved.info.strict) {
          await progress.race(resolved.injected.evaluateHandle((injected, {
            info,
            elements
          }) => {
            throw injected.strictModeViolationError(info.parsed, elements);
          }, {
            info: resolved.info,
            elements: currentScopingElements
          }));
        }
        progress.log("  locator resolved to " + currentScopingElements.length + " elements. Proceeding with the first one: " + resultElement.preview());
      } else if (resultElement) {
        progress.log("  locator resolved to " + resultElement.preview());
      }

      try {
        var result = null;
        if (returnAction === 'returnAll') {
          result = await action([resultElement, currentScopingElements]);
        } else {
          result = await action(resultElement);
        }
        if (result === 'error:notconnected') {
          progress.log('element was detached from the DOM, retrying');
          return continuePolling;
        } else if (result === 'internal:continuepolling') {
          return continuePolling;
        }
        return result;
      } finally {}
    `);

    // -- waitForSelector Method --
    const waitForSelectorMethod = frameClass.getMethod("waitForSelector");
    waitForSelectorMethod.setBodyText(`
      if ((options as any).visibility)
        throw new Error('options.visibility is not supported, did you mean options.state?');
      if ((options as any).waitFor && (options as any).waitFor !== 'visible')
        throw new Error('options.waitFor is not supported, did you mean options.state?');
      const { state = 'visible' } = options;
      if (!['attached', 'detached', 'visible', 'hidden'].includes(state))
        throw new Error(\`state: expected one of (attached|detached|visible|hidden)\`);
      if (performActionPreChecksAndLog)
        progress.log(\`waiting for \${this._asLocator(selector)}\${state === 'attached' ? '' : ' to be ' + state}\`);

      const promise = this._retryWithProgressIfNotConnected(progress, selector, options.strict, true, async handle => {
        const attached = !!handle;
        var visible = false;
        if (attached) {
          if (handle.parentNode.constructor.name == "ElementHandle") {
            visible = await handle.parentNode.evaluateInUtility(([injected, node, { handle }]) => {
              return handle ? injected.utils.isElementVisible(handle) : false;
            }, { handle });
          } else {
            visible = await handle.parentNode.evaluate((injected, { handle }) => {
              return handle ? injected.utils.isElementVisible(handle) : false;
            }, { handle });
          }
        }

        const success = {
          attached,
          detached: !attached,
          visible,
          hidden: !visible
        }[state];
        if (!success) return "internal:continuepolling";
        if (options.omitReturnValue) return null;

        const element = state === 'attached' || state === 'visible' ? handle : null;
        if (!element) return null;
        if (options.__testHookBeforeAdoptNode) await options.__testHookBeforeAdoptNode();
        try {
          return element;
        } catch (e) {
          return "internal:continuepolling";
        }
      }, "returnOnNotResolved");

      return scope ? scope._context._raceAgainstContextDestroyed(promise) : promise;
    `)

    // -- isVisibleInternal Method --
    const isVisibleInternalMethod = frameClass.getMethod("isVisibleInternal");
    isVisibleInternalMethod.setBodyText(`
      try {
        const metadata = { internal: false, log: [], method: "isVisible" };
        const progress = {
          log: message => metadata.log.push(message),
          metadata,
          race: (promise) => Promise.race(Array.isArray(promise) ? promise : [promise])
        }
        progress.log("waiting for " + this._asLocator(selector));
        if (selector === ":scope") {
          const scopeParentNode = scope.parentNode || scope;
          if (scopeParentNode.constructor.name == "ElementHandle") {
            return await scopeParentNode.evaluateInUtility(([injected, node, { scope: handle2 }]) => {
              const state = handle2 ? injected.elementState(handle2, "visible") : {
                matches: false,
                received: "error:notconnected"
              };
              return state.matches;
            }, { scope });
          } else {
            return await scopeParentNode.evaluate((injected, node, { scope: handle2 }) => {
              const state = handle2 ? injected.elementState(handle2, "visible") : {
                matches: false,
                received: "error:notconnected"
              };
              return state.matches;
            }, { scope });
          }
        } else {
          return await this._retryWithoutProgress(progress, selector, options.strict, false, async (handle) => {
            if (!handle) return false;
            if (handle.parentNode.constructor.name == "ElementHandle") {
              return await handle.parentNode.evaluateInUtility(([injected, node, { handle: handle2 }]) => {
                const state = handle2 ? injected.elementState(handle2, "visible") : {
                  matches: false,
                  received: "error:notconnected"
                };
                return state.matches;
              }, { handle });
            } else {
              return await handle.parentNode.evaluate((injected, { handle: handle2 }) => {
                const state = handle2 ? injected.elementState(handle2, "visible") : {
                  matches: false,
                  received: "error:notconnected"
                };
                return state.matches;
              }, { handle });
            }
          }, "returnOnNotResolved", null);
        }
      } catch (e) {
        if (this.isNonRetriableError(e)) throw e;
        return false;
      }
    `);

    // -- evaluateExpressionHandle Method --
    const evaluateExpressionHandleMethod = frameClass.getMethod("evaluateExpressionHandle");
    evaluateExpressionHandleMethod.setBodyText(`
      const context = await this._context(options.world ?? "utility");
      const value = await context.evaluateExpressionHandle(expression, options, arg);
      return value;
    `);

    // -- queryCount Method --
    const queryCountMethod = frameClass.getMethod("queryCount");
    queryCountMethod.setBodyText(`
      const metadata = { internal: false, log: [], method: "queryCount" };
      const progress = {
        log: message => metadata.log.push(message),
        metadata,
        race: (promise) => Promise.race(Array.isArray(promise) ? promise : [promise])
      }
      return await this._retryWithoutProgress(progress, selector, null, false, async (result) => {
        if (!result) return 0;
        const handle = result[0];
        const handles = result[1];
        return handle ? handles.length : 0;
      }, 'returnAll', null);
    `);

    // -- _expectInternal Method --
    const expectInternalMethod = frameClass.getMethod("_expectInternal");
    expectInternalMethod.setBodyText(`
      // The first expect check, a.k.a. one-shot, always finishes - even when progress is aborted.
      const race = (p) => noAbort ? p : progress.race(p);
      const isArray = options.expression === 'to.have.count' || options.expression.endsWith('.array');
      var log, matches, received, missingReceived;
      if (selector) {
        const { frame, info } = await race(this.selectors.resolveFrameForSelector(selector, { strict: true }));
        const action = async result => {
          if (!result) {
            if (options.expectedNumber === 0)
              return { matches: true };
            // expect(locator).toBeHidden() passes when there is no element.
            if (!options.isNot && options.expression === 'to.be.hidden')
              return { matches: true };
            // expect(locator).not.toBeVisible() passes when there is no element.
            if (options.isNot && options.expression === 'to.be.visible')
              return { matches: false };
            // expect(locator).toBeAttached({ attached: false }) passes when there is no element.
            if (!options.isNot && options.expression === 'to.be.detached')
              return { matches: true };
            // expect(locator).not.toBeAttached() passes when there is no element.
            if (options.isNot && options.expression === 'to.be.attached')
              return { matches: false };
            // expect(locator).not.toBeInViewport() passes when there is no element.
            if (options.isNot && options.expression === 'to.be.in.viewport')
              return { matches: false };
            // When none of the above applies, expect does not match.
            return { matches: options.isNot, missingReceived: true };
          }

          const handle = result[0];
          const handles = result[1];

          if (handle.parentNode.constructor.name == "ElementHandle") {
            return await handle.parentNode.evaluateInUtility(async ([injected, node, { handle, options, handles }]) => {
              return await injected.expect(handle, options, handles);
            }, { handle, options, handles });
          } else {
            return await handle.parentNode.evaluate(async (injected, { handle, options, handles }) => {
              return await injected.expect(handle, options, handles);
            }, { handle, options, handles });
          }
        }

        if (noAbort) {
          var { log, matches, received, missingReceived } = await this._retryWithoutProgress(progress, selector, !isArray, false, action, 'returnAll', null);
        } else {
          var { log, matches, received, missingReceived } = await race(this._retryWithProgressIfNotConnected(progress, selector, !isArray, false, action, 'returnAll'));
        }
      } else {
        const world = options.expression === 'to.have.property' ? 'main' : 'utility';
        const context = await race(this._context(world));
        const injected = await race(context.injectedScript());
        var { matches, received, missingReceived } = await race(injected.evaluate(async (injected, { options, callId }) => {
          return { ...await injected.expect(undefined, options, []) };
        }, { options, callId: progress.metadata.id }));
      }


      if (log)
        progress.log(log);
      // Note: missingReceived avoids \`unexpected value "undefined"\` when element was not found.
      if (matches === options.isNot) {
        lastIntermediateResult.received = missingReceived ? '<element(s) not found>' : received;
        lastIntermediateResult.isSet = true;
        if (!missingReceived && !Array.isArray(received))
          progress.log(\`  unexpected value "\${renderUnexpectedValue(options.expression, received)}"\`);
      }
      return { matches, received };
    `);

    // -- _callOnElementOnceMatches Method --
    const callOnElementOnceMatchesMethod = frameClass.getMethod("_callOnElementOnceMatches");
    callOnElementOnceMatchesMethod.setBodyText(`
      const callbackText = body.toString();
      progress.log("waiting for "+ this._asLocator(selector));
      var promise;
      if (selector === ":scope") {
        const scopeParentNode = scope.parentNode || scope;
        if (scopeParentNode.constructor.name == "ElementHandle") {
          promise = scopeParentNode.evaluateInUtility(([injected, node, { callbackText: callbackText2, scope: handle2, taskData: taskData2 }]) => {
            const callback = injected.eval(callbackText2);
            const haha = callback(injected, handle2, taskData2);
            return haha;
          }, {
            callbackText,
            scope,
            taskData
          });
        } else {
          promise = scopeParentNode.evaluate((injected, { callbackText: callbackText2, scope: handle2, taskData: taskData2 }) => {
            const callback = injected.eval(callbackText2);
            return callback(injected, handle2, taskData2);
          }, {
            callbackText,
            scope,
            taskData
          });
        }
      } else {
        promise = this._retryWithProgressIfNotConnected(progress, selector, options.strict, false, async (handle) => {
          if (handle.parentNode.constructor.name == "ElementHandle") {
            return await handle.parentNode.evaluateInUtility(([injected, node, { callbackText: callbackText2, handle: handle2, taskData: taskData2 }]) => {
              const callback = injected.eval(callbackText2);
              const haha = callback(injected, handle2, taskData2);
              return haha;
            }, {
              callbackText,
              handle,
              taskData
            });
          } else {
            return await handle.parentNode.evaluate((injected, { callbackText: callbackText2, handle: handle2, taskData: taskData2 }) => {
              const callback = injected.eval(callbackText2);
              return callback(injected, handle2, taskData2);
            }, {
              callbackText,
              handle,
              taskData
            });
          }
        })
      }
      return scope ? scope._context._raceAgainstContextDestroyed(promise) : promise;
    `)

    // -- _customFindElementsByParsed Method --
    frameClass.addMethod({
      name: "_customFindElementsByParsed",
      isAsync: true,
      parameters: [
        { name: "resolved" },
        { name: "client" },
        { name: "context" },
        { name: "documentScope" },
        { name: "progress" },
        { name: "parsed" },
      ],
    });
    const customFindElementsByParsedMethod = frameClass.getMethod("_customFindElementsByParsed");
    customFindElementsByParsedMethod.setBodyText(`
      var parsedEdits = { ...parsed };
      // Note: We start scoping at document level
      var currentScopingElements = [documentScope];
      while (parsed.parts.length > 0) {
        var part = parsed.parts.shift();
        parsedEdits.parts = [part];
        // Getting All Elements
        var elements = [];
        var elementsIndexes = [];

        if (part.name == "nth") {
          const partNth = Number(part.body);
          // Check if any Elements are currently scoped, else return empty array to continue polling
          if (currentScopingElements.length == 0) return [];
          // Check if the partNth is within the bounds of currentScopingElements
          if (partNth > currentScopingElements.length-1 || partNth < -(currentScopingElements.length-1)) {
            if (parsed.capture !== undefined) throw new Error("Can't query n-th element in a request with the capture.");
            return [];
          } else {
            currentScopingElements = [currentScopingElements.at(partNth)];
            continue;
          }
        } else if (part.name == "internal:or") {
          var orredElements = await this._customFindElementsByParsed(resolved, client, context, documentScope, progress, part.body.parsed);
          elements = currentScopingElements.concat(orredElements);
        } else if (part.name == "internal:and") {
          var andedElements = await this._customFindElementsByParsed(resolved, client, context, documentScope, progress, part.body.parsed);
          const backendNodeIds = new Set(andedElements.map(item => item.backendNodeId));
          elements = currentScopingElements.filter(item => backendNodeIds.has(item.backendNodeId));
        } else {
          for (const scope of currentScopingElements) {
            const describedScope = await client.send('DOM.describeNode', {
              objectId: scope._objectId,
              depth: -1,
              pierce: true
            });

            // Elements Queryed in the "current round"
            var queryingElements = [];
            function findClosedShadowRoots(node, results = []) {
              if (!node || typeof node !== 'object') return results;
              if (node.shadowRoots && Array.isArray(node.shadowRoots)) {
                for (const shadowRoot of node.shadowRoots) {
                  if (shadowRoot.shadowRootType === 'closed' && shadowRoot.backendNodeId) {
                    results.push(shadowRoot.backendNodeId);
                  }
                  findClosedShadowRoots(shadowRoot, results);
                }
              }
              if (node.nodeName !== 'IFRAME' && node.children && Array.isArray(node.children)) {
                for (const child of node.children) {
                  findClosedShadowRoots(child, results);
                }
              }
              return results;
            }

            var shadowRootBackendIds = findClosedShadowRoots(describedScope.node);
            var shadowRoots = [];
            for (var shadowRootBackendId of shadowRootBackendIds) {
              var resolvedShadowRoot = await client.send('DOM.resolveNode', {
                backendNodeId: shadowRootBackendId,
                contextId: context.delegate._contextId
              });
              shadowRoots.push(new dom.ElementHandle(context, resolvedShadowRoot.object.objectId));
            }

            for (var shadowRoot of shadowRoots) {
              const shadowElements = await shadowRoot.evaluateHandleInUtility(([injected, node, { parsed, callId }]) => {
               const elements = injected.querySelectorAll(parsed, node);
                if (callId) injected.markTargetElements(new Set(elements), callId);
                return elements
              }, {
                parsed: parsedEdits,
                callId: progress.metadata.id
              });

              const shadowElementsAmount = await shadowElements.getProperty("length");
              queryingElements.push([shadowElements, shadowElementsAmount, shadowRoot]);
            }

            // Document Root Elements (not in CSR)
            const rootElements = await scope.evaluateHandleInUtility(([injected, node, { parsed, callId }]) => {
              const elements = injected.querySelectorAll(parsed, node);
              if (callId) injected.markTargetElements(new Set(elements), callId);
              return elements
            }, {
              parsed: parsedEdits,
              callId: progress.metadata.id
            });
            const rootElementsAmount = await rootElements.getProperty("length");
            queryingElements.push([rootElements, rootElementsAmount, scope]);

            // Querying and Sorting the elements by their backendNodeId
            for (var queryedElement of queryingElements) {
              var elementsToCheck = queryedElement[0];
              var elementsAmount = await queryedElement[1].jsonValue();
              var parentNode = queryedElement[2];
              for (var i = 0; i < elementsAmount; i++) {
                if (parentNode.constructor.name == "ElementHandle") {
                  var elementToCheck = await parentNode.evaluateHandleInUtility(([injected, node, { index, elementsToCheck }]) => { return elementsToCheck[index]; }, { index: i, elementsToCheck: elementsToCheck });
                } else {
                  var elementToCheck = await parentNode.evaluateHandle((injected, { index, elementsToCheck }) => { return elementsToCheck[index]; }, { index: i, elementsToCheck: elementsToCheck });
                }
                // For other Functions/Utilities
                elementToCheck.parentNode = parentNode;
                var resolvedElement = await client.send('DOM.describeNode', {
                  objectId: elementToCheck._objectId,
                  depth: -1,
                });
                // Note: Possible Bug, Maybe well actually have to check the Documents Node Position instead of using the backendNodeId
                elementToCheck.backendNodeId = resolvedElement.node.backendNodeId;
                elementToCheck.nodePosition = this.selectors._findElementPositionInDomTree(elementToCheck, describedScope.node, context, "");
                elements.push(elementToCheck);
              }
            }
          }
        }

        // Sorting elements by their nodePosition, which is a index to the Element in the DOM tree
        const getParts = (pos) => (pos || '').split('.').filter(Boolean).map(Number);
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

        // Remove duplicates by backendNodeId, keeping the first occurrence
        currentScopingElements = Array.from(
          new Map(elements.map((e) => [e.backendNodeId, e])).values()
        );
      }
      return currentScopingElements;
    `);
}