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
      "frame._iframeWorld = undefined;",
      "frame._mainWorld = undefined;",
      "frame._isolatedWorld = undefined;"
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
        const result = await handle.evaluateExpression(expression, { isFunction }, arg);
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
      return await this._retryWithoutProgress(progress, selector, {strict: null, performActionPreChecks: false}, async (result) => {
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
          if (describedNode && describedNode.node.contentDocument) {
            var resolvedNode = await client._sendMayFail("DOM.resolveNode", {
              backendNodeId: describedNode.node.contentDocument.backendNodeId,
            });
            if (resolvedNode && resolvedNode.object && resolvedNode.object.objectId) {
              var _executionContextId = parseInt(resolvedNode.object.objectId.split(".")[1], 10);
              return _executionContextId;
            }
          }
        }
      } catch (e) {}
      return 0;
    `);

    // -- _context Method --
    const contextMethod = frameClass.getMethod("_context");
    contextMethod.setIsAsync(true);
    contextMethod.setBodyText(`
      if (this.isDetached()) throw new Error('Frame was detached');

      // patchright: helper to register a context without creating a duplicate via _onExecutionContextCreated
      const registerContext = (session, executionContextId, context, worldName) => {
        // Register in frame's context data (resolves waiters)
        this._contextCreated(worldName, context);
        // Register in session's context map
        session._contextIdToContext.set(executionContextId, context);
        // Install exposed bindings
        for (const name of session._exposedBindingNames)
          session._client._sendMayFail('Runtime.addBinding', { name, executionContextId });
        for (const source of session._exposedBindingScripts)
          session._client._sendMayFail('Runtime.evaluate', { expression: source, contextId: executionContextId, awaitPromise: true });
      };

      try {
        var session = this._page.delegate._sessionForFrame(this)
        var client = session._client
      } catch (e) {
        var session = this._page.delegate._mainFrameSession
        var client = session._client
      }

      if (world == "main") {
        var iframeExecutionContextId = await this._getFrameMainFrameContextId(client)
        // Iframe Only
        if (this != this._page.mainFrame() && iframeExecutionContextId && this._iframeWorld == undefined) {
          var executionContextId = iframeExecutionContextId
          var crContext = new CRExecutionContext(client, { id: executionContextId }, this._id)
          this._iframeWorld = new FrameExecutionContext(crContext, this, world)
          registerContext(session, executionContextId, this._iframeWorld, world)
        } else if (this._mainWorld == undefined) {
          // patchright: use promise cache to prevent concurrent initialization races
          if (!this._mainWorldInitPromise) {
            this._mainWorldInitPromise = (async () => {
              var globalThis = await client._sendMayFail('Runtime.evaluate', {
                expression: "globalThis",
                serializationOptions: { serialization: "idOnly" }
              });
              if (!globalThis) {
                this._mainWorldInitPromise = undefined;
                if (this.isDetached()) throw new Error('Frame was detached');
                return
              }
              var globalThisObjId = globalThis["result"]['objectId']
              var executionContextId = parseInt(globalThisObjId.split('.')[1], 10);
              var crContext = new CRExecutionContext(client, { id: executionContextId }, this._id)
              this._mainWorld = new FrameExecutionContext(crContext, this, world)
              registerContext(session, executionContextId, this._mainWorld, world)
            })();
          }
          await this._mainWorldInitPromise;
        }
      }
      if (world != "main") {
        if (this._isolatedWorld == undefined) {
          if (!this._isolatedWorldInitPromise) {
            this._isolatedWorldInitPromise = (async () => {
              var result = await client._sendMayFail('Page.createIsolatedWorld', {
                frameId: this._id, grantUniveralAccess: true, worldName: "utility"
              });
              if (!result) {
                this._isolatedWorldInitPromise = undefined;
                if (this.isDetached()) throw new Error("Frame was detached");
                return
              }
              var executionContextId = result.executionContextId
              var crContext = new CRExecutionContext(client, { id: executionContextId }, this._id)
              this._isolatedWorld = new FrameExecutionContext(crContext, this, "utility")
              registerContext(session, executionContextId, this._isolatedWorld, "utility")
            })();
          }
          await this._isolatedWorldInitPromise;
        }
        return this._isolatedWorld;
      } else if (this != this._page.mainFrame() && this._iframeWorld) {
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
          this.waitForLoadState(progress, waitUntil).then(resolve).catch(reject);
        });
        const setContentPromise = this._page.delegate._sessionForFrame(this)._client.send("Page.setDocumentContent", {
          frameId: this._id,
          html
        });
        await Promise.all([setContentPromise, lifecyclePromise]);

        return null;
      });
    `);

    /*
    // -- retryWithProgressAndTimeouts Method --
    const retryWithProgressAndTimeoutsMethod = frameClass.getMethod("retryWithProgressAndTimeouts");
    retryWithProgressAndTimeoutsMethod.setBodyText(`
      const continuePolling = Symbol('continuePolling');
      timeouts = [0, ...timeouts];
      let timeoutIndex = 0;
      while (true) {
        const timeout = timeouts[Math.min(timeoutIndex++, timeouts.length - 1)];
        if (timeout) {
          // Make sure we react immediately upon page close or frame detach.
          // We need this to show expected/received values in time.
          const actionPromise = new Promise(f => setTimeout(f, timeout));
          await progress.race(LongStandingScope.raceMultiple([
            this._page.openScope,
            this._detachedScope,
          ], actionPromise));
        }
        try {
          const result = await action(continuePolling);
          if (result === continuePolling)
            continue;
          return result as R;
        } catch (e) {
          if (this.isNonRetriableError(e))
            throw e;
          continue;
        }
      }
    `);
    */

    // -- _retryWithProgressIfNotConnected Method --
    const retryWithProgressIfNotConnectedMethod = frameClass.getMethod("_retryWithProgressIfNotConnected");
    retryWithProgressIfNotConnectedMethod.addParameter({
        name: "returnAction",
        type: "boolean | undefined",
    });
    retryWithProgressIfNotConnectedMethod.setBodyText(`
      if (!(options as any)?.__patchrightSkipRetryLogWaiting)
        progress.log("waiting for " + this._asLocator(selector));
      return this.retryWithProgressAndTimeouts(progress, [0, 20, 50, 100, 100, 500], async continuePolling => {
        return this._retryWithoutProgress(progress, selector, options, action, returnAction, continuePolling);
      });
    `);

    // -- _retryWithoutProgress Method --
    frameClass.addMethod({
      name: "_retryWithoutProgress",
      isAsync: true,
      parameters: [
        { name: "progress" },
        { name: "selector" },
        { name: "options" },
        { name: "action" },
        { name: "returnAction" },
        { name: "continuePolling" },
      ],
    });
    // options.strict, options.performActionPreChecks
    const customRetryWithoutProgressMethod = frameClass.getMethod("_retryWithoutProgress");
    customRetryWithoutProgressMethod.setBodyText(`
      if (options.performActionPreChecks) await this._page.performActionPreChecks(progress);
      const resolved = await this.selectors.resolveInjectedForSelector(selector, { strict: options.strict }, (options as any).__patchrightInitialScope);
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
      let documentScope = new dom.ElementHandle(utilityContext, documentNode.result.objectId);
      let initialScope = documentScope;
      if ((resolved as any).scope) {
        const scopeBackendNodeId = (resolved as any).scope._objectId ? (await client._sendMayFail('DOM.describeNode', { objectId: (resolved as any).scope._objectId }))?.node?.backendNodeId : null;
        if (scopeBackendNodeId) {
          const scopeInUtility = await client._sendMayFail('DOM.resolveNode', { backendNodeId: scopeBackendNodeId, executionContextId: utilityContext.delegate._contextId });
          if (scopeInUtility?.object?.objectId)
            initialScope = new dom.ElementHandle(utilityContext, scopeInUtility.object.objectId);
        }
      }
      (progress as any).__patchrightInitialScope = (resolved as any).scope;

      // patchright - Save parsed selector before _customFindElementsByParsed mutates it via parts.shift()
      const parsedSnapshot = (options as any).__patchrightWaitForSelector ? JSON.parse(JSON.stringify(resolved.info.parsed)) : null;
      let currentScopingElements;
      try {
        currentScopingElements = await this._customFindElementsByParsed(resolved, client, mainContext, initialScope, progress, resolved.info.parsed);
      } catch (e) {
        if ("JSHandles can be evaluated only in the context they were created!" === e.message) return continuePolling;
        if (e instanceof TypeError && e.message.includes("is not a function")) return continuePolling;
        await progress.race(resolved.injected.evaluateHandle((injected, { error }) => { throw error }, { error: e }));
      }

      if (currentScopingElements.length == 0) {
        if ((options as any).__testHookNoAutoWaiting || (options as any).noAutoWaiting)
          throw new dom.NonRecoverableDOMError('Element(s) not found');
        // patchright - CDP-based element search is non-atomic and can temporarily miss
        // elements during DOM mutations. Verify element absence in-page before reporting
        // "not found" to the waitForSelector callback.
        if (parsedSnapshot && (returnAction === 'returnOnNotResolved' || returnAction === 'returnAll')) {
          const elementCount = await resolved.injected.evaluate((injected, { parsed }) => {
            return injected.querySelectorAll(parsed, document).length;
          }, { parsed: parsedSnapshot }).catch(() => 0);
          if (elementCount > 0)
            return continuePolling;
        }
        if (returnAction === 'returnOnNotResolved' || returnAction === 'returnAll') {
          const result = await action(null);
          return result === "internal:continuepolling" ? continuePolling : result;
        }
        return continuePolling;
      }
      const resultElement = currentScopingElements[0];
      await resultElement._initializePreview().catch(() => {});
      let visibilityQualifier = '';
      if (options && (options as any).__patchrightWaitForSelector) {
        visibilityQualifier = await resultElement.evaluateInUtility(([injected, node]) => injected.utils.isElementVisible(node) ? 'visible' : 'hidden', {}).catch(() => '');
      }
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
        progress.log("  locator resolved to " + (visibilityQualifier ? visibilityQualifier + " " : "") + resultElement.preview().replace("JSHandle@", ""));
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
        // patchright - CDP-based element search may return stale handles during DOM mutations.
        // When waitForSelector reports hidden success (result === null with a found element),
        // the handle may be stale (disconnected). Verify in-page that no matching visible
        // elements actually exist before accepting the result.
        if (parsedSnapshot && result === null && ((options as any).state === 'hidden' || (options as any).state === 'detached')) {
          const visibleCount = await resolved.injected.evaluate((injected, { parsed }) => {
            const elements = injected.querySelectorAll(parsed, document);
            return elements.filter(e => injected.utils.isElementVisible(e)).length;
          }, { parsed: parsedSnapshot }).catch(() => 0);
          if (visibleCount > 0)
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

      const promise = this._retryWithProgressIfNotConnected(progress, selector, { ...options, performActionPreChecks: true, __patchrightWaitForSelector: true, __patchrightInitialScope: scope }, async handle => {
        if (scope) {
          const scopeIsConnected = await scope.evaluateInUtility(([injected, node]) => node.isConnected, {}).catch(() => false);
          if (scopeIsConnected !== true) {
            if (state === 'hidden' || state === 'detached')
              return null;
            throw new dom.NonRecoverableDOMError('Element is not attached to the DOM');
          }
        }
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

      const resultPromise = scope ? scope._context._raceAgainstContextDestroyed(promise) : promise;
      return resultPromise.catch(e => {
        if (this.isDetached() && (e as any)?.message?.includes('Execution context was destroyed'))
          throw new Error('Frame was detached');
        throw e;
      });
    `)

    // -- waitForFunctionExpression Method --
    // Race the inner evaluate against _detachedScope so frame detachment immediately cancels the operation
    const waitForFunctionExpressionMethod = frameClass.getMethod("waitForFunctionExpression");
    const waitForFunctionBody = waitForFunctionExpressionMethod.getBody();
    const matchingReturnStmts = waitForFunctionBody.getDescendantsOfKind(SyntaxKind.ReturnStatement).filter(stmt =>
        stmt.getText().includes('progress.race(handle.evaluateHandle(h => h.result))')
    );
    // Take the last (innermost) match to avoid replacing the outer
    // `return this.retryWithProgressAndTimeouts(...)` statement whose
    // getText() also contains the substring.
    const targetReturnStmt = matchingReturnStmts[matchingReturnStmts.length - 1];
    if (targetReturnStmt) {
        targetReturnStmt.replaceWithText('return await progress.race(this._detachedScope.race(handle.evaluateHandle(h => h.result)));');
    }

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
          return await this._retryWithoutProgress(progress, selector, { ...options, performActionPreChecks: false}, async (handle) => {
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

    // -- _onDetached Method --
    // Destroy custom context fields (_mainWorld, _iframeWorld, _isolatedWorld) on frame detach.
    // Without this, pending evaluations on these contexts never get cancelled, causing timeouts.
    const onDetachedMethod = frameClass.getMethod("_onDetached");
    onDetachedMethod.setBodyText(`
      this._stopNetworkIdleTimer();
      this._detachedScope.close(new Error('Frame was detached'));
      for (const data of this._contextData.values()) {
        if (data.context)
          data.context.contextDestroyed('Frame was detached');
        data.contextPromise.resolve({ destroyedReason: 'Frame was detached' });
      }
      if (this._mainWorld)
        this._mainWorld.contextDestroyed('Frame was detached');
      if (this._iframeWorld)
        this._iframeWorld.contextDestroyed('Frame was detached');
      if (this._isolatedWorld)
        this._isolatedWorld.contextDestroyed('Frame was detached');
      if (this._parentFrame)
        this._parentFrame._childFrames.delete(this);
      this._parentFrame = null;
    `);

    // -- evaluateExpression Method --
    const evaluateExpressionMethod = frameClass.getMethod("evaluateExpression");
    evaluateExpressionMethod.setBodyText(`
      const context = await this._detachedScope.race(this._context(options.world ?? "main"));
      const value = await this._detachedScope.race(context.evaluateExpression(expression, options, arg));
      return value;
    `);

    // -- evaluateExpressionHandle Method --
    const evaluateExpressionHandleMethod = frameClass.getMethod("evaluateExpressionHandle");
    evaluateExpressionHandleMethod.setBodyText(`
      const context = await this._detachedScope.race(this._context(options.world ?? "utility"));
      const value = await this._detachedScope.race(context.evaluateExpressionHandle(expression, options, arg));
      return value;
    `);

    // -- nonStallingEvaluateInExistingContext Method --
    const nonStallingEvalMethod = frameClass.getMethod("nonStallingEvaluateInExistingContext");
    nonStallingEvalMethod.setBodyText(`
      return this.raceAgainstEvaluationStallingEvents(async () => {
        try { await this._context(world); } catch {}
        const context = this._contextData.get(world)?.context;
        if (!context)
          throw new Error('Frame does not yet have the execution context');
        return context.evaluateExpression(expression, { isFunction: false });
      });
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
      return await this._retryWithoutProgress(progress, selector, {strict: null, performActionPreChecks: false }, async (result) => {
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
        var frame, info;
        try {
          var { frame, info } = await race(this.selectors.resolveFrameForSelector(selector, { strict: true }));
        } catch (e) { }
        const action = async result => {
          if (!result) {
            if (options.expectedNumber === 0)
              return { matches: true };
            if (options.isNot && options.expectedNumber)
              return { matches: false, received: 0 };
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
            // expect(locator).toHaveText([]) pass when there is no element.
            if (options.expression === "to.have.text.array") {
              if (options.expectedText.length === 0)
                return { matches: true, received: [] };
              if (options.isNot && options.expectedText.length !== 0)
                return { matches: false, received: [] };
            }
            // When none of the above applies, expect does not match.
            return { matches: options.isNot, missingReceived: true };
          }

          const handle = result[0];
          const handles = result[1];

          if (options.expression === "to.have.property") {
            const mainCtx = await this._mainContext();
            const mainInjected = await mainCtx.injectedScript();
            const adoptedHandle = handle._context === mainCtx ? handle : await this._page.delegate.adoptElementHandle(handle, mainCtx);
            const adoptedHandles: any[] = [];
            for (const h of handles) {
              adoptedHandles.push(h._context === mainCtx ? h : await this._page.delegate.adoptElementHandle(h, mainCtx));
            }
            return await mainInjected.evaluate(async (injected, { handle: handle2, options: options2, handles: handles2 }) => {
              return await injected.expect(handle2, options2, handles2);
            }, { handle: adoptedHandle, options, handles: adoptedHandles });
          }

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
          var { log, matches, received, missingReceived } = await this._retryWithoutProgress(progress, selector, {strict: !isArray, performActionPreChecks: false}, action, 'returnAll', null);
        } else {
          var { log, matches, received, missingReceived } = await race(this._retryWithProgressIfNotConnected(progress, selector, { strict: !isArray, performActionPreChecks: false, __patchrightSkipRetryLogWaiting: true } as any, action, 'returnAll'));
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
        if (missingReceived) {
          lastIntermediateResult.errorMessage = 'Error: element(s) not found';
        } else {
          lastIntermediateResult.errorMessage = undefined;
          lastIntermediateResult.received = received;
        }
        lastIntermediateResult.isSet = true;
        if (!missingReceived) {
          const rendered = renderUnexpectedValue(options.expression, received);
          if (rendered !== undefined)
            progress.log('  unexpected value "' + rendered + '"');
        }
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
          if (options?.mainWorld) {
            promise = (async () => {
              const mainContext = await this._mainContext();
              const adoptedScope = await this._page.delegate.adoptElementHandle(scope, mainContext);
              try {
                return await mainContext.evaluate(([injected, node, { callbackText: callbackText2, scope: handle2, taskData: taskData2 }]) => {
                  const callback = injected.eval(callbackText2);
                  return callback(injected, handle2, taskData2);
                }, [
                  await mainContext.injectedScript(),
                  adoptedScope,
                  { callbackText, scope: adoptedScope, taskData },
                ]);
              } finally {
                adoptedScope.dispose();
              }
            })();
          } else {
            promise = scopeParentNode.evaluateInUtility(([injected, node, { callbackText: callbackText2, scope: handle2, taskData: taskData2 }]) => {
              const callback = injected.eval(callbackText2);
              return callback(injected, handle2, taskData2);
            }, {
              callbackText,
              scope,
              taskData
            });
          }
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

        promise = this._retryWithProgressIfNotConnected(progress, selector, { ...options, performActionPreChecks: false }, async (handle) => {
          if (handle.parentNode.constructor.name == "ElementHandle") {
            if (options?.mainWorld) {
              const mainContext = await handle._frame._mainContext();
              const adoptedHandle = await this._page.delegate.adoptElementHandle(handle, mainContext);
              try {
                return await mainContext.evaluate(([injected, node, { callbackText: callbackText2, handle: handle2, taskData: taskData2 }]) => {
                  const callback = injected.eval(callbackText2);
                  return callback(injected, handle2, taskData2);
                }, [
                  await mainContext.injectedScript(),
                  adoptedHandle,
                  { callbackText, handle: adoptedHandle, taskData },
                ]);
              } finally {
                adoptedHandle.dispose();
              }
            }

            // Handling dispatch_event's in isolated and Main Contexts
            const [taskScope] = Object.values(taskData?.eventInit ?? {});
            if (taskScope) {
              const taskScopeContext = taskScope._context;
              const adoptedHandle = await handle._adoptTo(taskScopeContext);
              return await taskScopeContext.evaluate(([injected, node, { callbackText: callbackText2, adoptedHandle: handle2, taskData: taskData2 }]) => {
                const callback = injected.eval(callbackText2);
                return callback(injected, handle2, taskData2);
              }, [
                await taskScopeContext.injectedScript(),
                adoptedHandle,
                { callbackText, adoptedHandle, taskData },
              ]);
            }

            return await handle.parentNode.evaluateInUtility(([injected, node, { callbackText: callbackText2, handle: handle2, taskData: taskData2 }]) => {
              const callback = injected.eval(callbackText2);
              return callback(injected, handle2, taskData2);
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