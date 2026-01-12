import { Project, SyntaxKind } from "ts-morph";

// ----------------------------
// server/chromium/crPage.ts
// ----------------------------
export function patchCRPage(project) {
    // Add source file to the project
    const crPageSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/chromium/crPage.ts",);
    // Add the custom import and comment at the start of the file
    crPageSourceFile.insertStatements(0, [
      "// patchright - custom imports",
      "import crypto from 'crypto';",
      "",
    ]);

    // ------- CRPage Class -------
    const crPageClass = crPageSourceFile.getClass("CRPage");

    // -- CRPage Constructor --
    const crPageConstructor = crPageClass
      .getConstructors()
      .find((ctor) =>
        ctor
          .getText()
          .includes(
            "constructor(client: CRSession, targetId: string, browserContext: CRBrowserContext, opener: CRPage | null",
          ),
      );
    const statementToReplace = crPageConstructor
      .getStatements()
      .find(
        (statement) => statement.getText() === "this.updateRequestInterception();",
      );
    if (statementToReplace) {
      // Replace the statement with the new code
      statementToReplace.replaceWithText(`this._networkManager.setRequestInterception(true);
    this.initScriptTag = crypto.randomBytes(20).toString('hex');`);
    }

    // -- exposeBinding Method --
    crPageClass.addMethod({
      name: "exposeBinding",
      isAsync: true,
      parameters: [
        { name: "binding" },
      ],
    });
    const crExposeBindingMethod = crPageClass.getMethod("exposeBinding");
    crExposeBindingMethod.setBodyText(`
      await this._forAllFrameSessions(frame => frame._initBinding(binding));
      await Promise.all(this._page.frames().map(frame => frame.evaluateExpression(binding.source).catch(e => {})));
    `);

    // -- removeExposedBindings Method --
    crPageClass.addMethod({
      name: "removeExposedBindings",
      isAsync: true,
    });
    const crRemoveExposedBindingsMethod = crPageClass.getMethod(
      "removeExposedBindings",
    );
    crRemoveExposedBindingsMethod.setBodyText(`
      await this._forAllFrameSessions(frame => frame._removeExposedBindings());
    `);

    // -- removeNonInternalInitScripts Method --
    // crPageClass
    //   .getMethod("removeNonInternalInitScripts")
    //   .rename("removeInitScripts");

    // -- addInitScript Method --
    const addInitScriptMethod = crPageClass.getMethod("addInitScript");
    const addInitScriptMethodBody = addInitScriptMethod.getBody();
    // Insert a new line of code before the first statement
    addInitScriptMethodBody.insertStatements(0, "this._page.initScripts.push(initScript);",);


    // ------- FrameSession Class -------
    const frameSessionClass = crPageSourceFile.getClass("FrameSession");
    // Add Properties to the Frame Class
    frameSessionClass.addProperty({
      name: "_exposedBindingNames",
      type: "string[]",
      initializer: "[]",
    });
    frameSessionClass.addProperty({
      name: "_evaluateOnNewDocumentScripts",
      type: "string[]",
      initializer: "[]",
    });
    frameSessionClass.addProperty({
      name: "_parsedExecutionContextIds",
      type: "number[]",
      initializer: "[]",
    });
    frameSessionClass.addProperty({
      name: "_exposedBindingScripts",
      type: "string[]",
      initializer: "[]",
    });
    const evaluateOnNewDocumentIdentifiers = frameSessionClass.getProperty(
      "_evaluateOnNewDocumentIdentifiers",
    );
    // if (evaluateOnNewDocumentIdentifiers) evaluateOnNewDocumentIdentifiers.remove();

    // -- _addRendererListeners Method --
    const addRendererListenersMethod = frameSessionClass.getMethod("_addRendererListeners");
    const addRendererListenersMethodBody = addRendererListenersMethod.getBody();
    // Insert a new line of code before the first statement
    /*addRendererListenersMethodBody.insertStatements(
      0,
      `this._client._sendMayFail("Debugger.enable", {});
    eventsHelper.addEventListener(this._client, 'Debugger.scriptParsed', event => {
      if (!this._parsedExecutionContextIds.includes(event.executionContextId)) this._parsedExecutionContextIds.push(event.executionContextId);
    })`,
    );*/

    // -- _initialize Method --
    const initializeFrameSessionMethod = frameSessionClass.getMethod("_initialize");
    const initializeFrameSessionMethodBody = initializeFrameSessionMethod.getBody();
    const promisesDeclaration = initializeFrameSessionMethod.getVariableDeclarationOrThrow("promises");
    // Find the initializer array
    const promisesInitializer = promisesDeclaration.getInitializerIfKindOrThrow(
      SyntaxKind.ArrayLiteralExpression,
    );
    // Find the relevant element inside the array that we need to update
    promisesInitializer.getElements().forEach((element) => {
      if (
        element.getText().includes("this._client.send('Runtime.enable'") ||
        element
          .getText()
          .includes("this._client.send('Runtime.addBinding', { name: PageBinding.kPlaywrightBinding })")
      ) {
        promisesInitializer.removeElement(element);
      }
    });
    // Find the relevant element inside the array that we need to update
    const pageGetFrameTreeCall = promisesInitializer
      .getElements()
      .find((element) =>
        element.getText().startsWith("this._client.send('Page.getFrameTree'"),
      );
    if (
      pageGetFrameTreeCall &&
      pageGetFrameTreeCall.isKind(SyntaxKind.CallExpression)
    ) {
      const thenBlock = pageGetFrameTreeCall
        .asKindOrThrow(SyntaxKind.CallExpression)
        .getFirstDescendantByKindOrThrow(SyntaxKind.ArrowFunction)
        .getBody()
        .asKindOrThrow(SyntaxKind.Block);
      // Remove old loop and logic for localFrames and isolated world creation
      const statementsToRemove = thenBlock
        .getStatements()
        .filter(
          (statement) =>
            statement
              .getText()
              .includes(
                "const localFrames = this._isMainFrame() ? this._page.frames()",
              ) ||
            statement
              .getText()
              .includes("this._client._sendMayFail('Page.createIsolatedWorld', {"),
        );
      statementsToRemove.forEach((statement) => statement.remove());
      // Find the IfStatement that contains the "else" block
      const ifStatement = thenBlock
        .getStatements()
        .find(
          (statement) =>
            statement.isKind(SyntaxKind.IfStatement) &&
            statement.getText().includes("Page.lifecycleEvent"),
        );
      if (ifStatement && ifStatement.isKind(SyntaxKind.IfStatement)) {
        const elseStatement = ifStatement.getElseStatement();
        elseStatement.insertStatements(0, `
        const localFrames = this._isMainFrame() ? this._page.frames() : [this._page.frameManager.frame(this._targetId)!];
          for (const frame of localFrames) {
            this._page.frameManager.frame(frame._id)._context("utility");
            for (const binding of this._crPage._browserContext._pageBindings.values())
              frame.evaluateExpression(binding.source).catch(e => {});
            for (const source of this._crPage._browserContext.initScripts)
              frame.evaluateExpression(source).catch(e => {});
          }
        `);
      }
    }
    // Allow focus control on pages https://github.com/Kaliiiiiiiiii-Vinyzu/patchright/issues/137#event-20580557051
    const focusControlStatement = initializeFrameSessionMethodBody
        .getDescendantsOfKind(SyntaxKind.IfStatement)
        .find((statement) => statement.getText().startsWith("if (this._isMainFrame()")
                          && statement.getText().includes("Emulation.setFocusEmulationEnabled"));
    if (focusControlStatement) {
        focusControlStatement.replaceWithText(`
        if (this._isMainFrame() && !this._crPage._browserContext._options.focusControl)
            promises.push(this._client.send("Emulation.setFocusEmulationEnabled", { enabled: true }));
        `);
    }
    // Find the initScript Evaluation Loop
    initializeFrameSessionMethodBody
      .getDescendantsOfKind(SyntaxKind.ForOfStatement)
      .forEach((statement) => {
        if (statement.getText().includes("this._crPage._page.allInitScripts()")) {
          if (
            statement
              .getText()
              .includes("frame.evaluateExpression(initScript.source)")
          ) {
            statement.replaceWithText(`
              for (const binding of this._crPage._browserContext._pageBindings.values()) frame.evaluateExpression(binding.source).catch(e => {});
              for (const initScript of this._crPage._browserContext.initScripts) frame.evaluateExpression(initScript.source).catch(e => {});
            `);
          } else if (
            statement
              .getText()
              .includes("promises.push(this._evaluateOnNewDocument(")
          ) {
            statement.replaceWithText(`
              for (const binding of this._crPage._page.allBindings()) promises.push(this._initBinding(binding));
              for (const initScript of this._crPage._browserContext.initScripts) promises.push(this._evaluateOnNewDocument(initScript, 'main'));
              for (const initScript of this._crPage._page.initScripts) promises.push(this._evaluateOnNewDocument(initScript, 'main'));
            `);
          }
        }
    });

    // -- _initBinding Method --
    frameSessionClass.addMethod({
      name: "_initBinding",
      isAsync: true,
      parameters: [
        {
          name: "binding",
          initializer: "PageBinding",
        },
      ],
    });
    const initBindingMethod = frameSessionClass.getMethod("_initBinding");
    initBindingMethod.setBodyText(`
      var result = await this._client._sendMayFail('Page.createIsolatedWorld', {
        frameId: this._targetId, grantUniveralAccess: true, worldName: "utility"
      });
      if (!result) return
      var isolatedContextId = result.executionContextId

      var globalThis = await this._client._sendMayFail('Runtime.evaluate', {
        expression: "globalThis",
        serializationOptions: { serialization: "idOnly" }
      });
      if (!globalThis) return
      var globalThisObjId = globalThis["result"]['objectId']
      var mainContextId = parseInt(globalThisObjId.split('.')[1], 10);

      await Promise.all([
        this._client._sendMayFail('Runtime.addBinding', { name: binding.name }),
        this._client._sendMayFail('Runtime.addBinding', { name: binding.name, executionContextId: mainContextId }),
        this._client._sendMayFail('Runtime.addBinding', { name: binding.name, executionContextId: isolatedContextId }),
        // this._client._sendMayFail("Runtime.evaluate", { expression: binding.source, contextId: mainContextId, awaitPromise: true })
      ]);
      this._exposedBindingNames.push(binding.name);
      this._exposedBindingScripts.push(binding.source);
      //this._client._sendMayFail('Runtime.runIfWaitingForDebugger')`);
      // initBindingMethod.setBodyText(`const [, response] = await Promise.all([
      //   this._client.send('Runtime.addBinding', { name: binding.name }),
      //   this._client.send('Page.addScriptToEvaluateOnNewDocument', { source: binding.source })
      // ]);
      // this._exposedBindingNames.push(binding.name);
      // if (!binding.name.startsWith('__pw'))
      //   this._evaluateOnNewDocumentIdentifiers.push(response.identifier);`);

      // -- _removeExposedBindings Method --
      frameSessionClass.addMethod({
        name: "_removeExposedBindings",
        isAsync: true,
      });
      const fsRemoveExposedBindingsMethod = frameSessionClass.getMethod(
        "_removeExposedBindings",
      );
      fsRemoveExposedBindingsMethod.setBodyText(`const toRetain: string[] = [];
      const toRemove: string[] = [];
      for (const name of this._exposedBindingNames)
        (name.startsWith('__pw_') ? toRetain : toRemove).push(name);
      this._exposedBindingNames = toRetain;
      await Promise.all(toRemove.map(name => this._client.send('Runtime.removeBinding', { name })));
    `);

    // -- _navigate Method --
    /*const navigateMethod = frameSessionClass.getMethod("_navigate");
    const navigateMethodBody = navigateMethod.getBody();
    // Insert the new line of code after the responseAwaitStatement
    navigateMethodBody.insertStatements(
      1,
      `this._client._sendMayFail('Page.waitForDebugger');`,
    );*/

    // -- _onLifecycleEvent & _onFrameNavigated Method --
    for (const methodName of ["_onLifecycleEvent", "_onFrameNavigated"]) {
      const frameSessionMethod = frameSessionClass.getMethod(methodName);
      const frameSessionMethodBody = frameSessionMethod.getBody();
      frameSessionMethod.setIsAsync(true);
      frameSessionMethodBody.addStatements(`await this._client._sendMayFail('Runtime.runIfWaitingForDebugger');
      var document = await this._client._sendMayFail("DOM.getDocument");
      if (!document) return
      var query = await this._client._sendMayFail("DOM.querySelectorAll", {
        nodeId: document.root.nodeId,
        selector: "[class=" + this._crPage.initScriptTag + "]"
      });
      if (!query) return
      for (const nodeId of query.nodeIds) await this._client._sendMayFail("DOM.removeNode", { nodeId: nodeId });
      await this._client._sendMayFail('Runtime.runIfWaitingForDebugger');
      // ensuring execution context
      try { await this._page.frameManager.frame(this._targetId)._context("utility") } catch { };`);
    }

    // -- _onExecutionContextCreated Method --
    const onExecutionContextCreatedMethod = frameSessionClass.getMethod("_onExecutionContextCreated");
    const onExecutionContextCreatedMethodBody = onExecutionContextCreatedMethod.getBody();
    onExecutionContextCreatedMethodBody.insertStatements(0, `
      for (const name of this._exposedBindingNames)
        this._client._sendMayFail('Runtime.addBinding', { name: name, executionContextId: contextPayload.id });
    `);
    onExecutionContextCreatedMethodBody.insertStatements(2, `
      if (contextPayload.auxData.type == "worker") throw new Error("ExecutionContext is worker");
    `);
    // Locate the statements you want to replace
    const statementsToRemove = onExecutionContextCreatedMethod
      .getStatements()
      .filter((statement) => {
        const text = statement.getText();
        return (
          text.includes("let worldName: types.World") ||
          text.includes(
            "if (contextPayload.auxData && !!contextPayload.auxData.isDefault)",
          ) ||
          text.includes("worldName = 'main'") ||
          text.includes("else if (contextPayload.name === UTILITY_WORLD_NAME)") ||
          text.includes("worldName = 'utility'")
        );
      });
    // If the statements are found, remove them
    statementsToRemove.forEach((statement) => {
      if (statement == statementsToRemove[0])
        statement.replaceWithText("let worldName = contextPayload.name;");
      else statement.remove();
    });
    onExecutionContextCreatedMethodBody.addStatements(`
      for (const source of this._exposedBindingScripts) {
        this._client._sendMayFail("Runtime.evaluate", {
          expression: source,
          contextId: contextPayload.id,
          awaitPromise: true,
        })
      }
    `);

    // -- _onAttachedToTarget Method --
    const onAttachedToTargetMethod = frameSessionClass.getMethod("_onAttachedToTarget");
    onAttachedToTargetMethod.setIsAsync(true);
    const onAttachedToTargetMethodBody = onAttachedToTargetMethod.getBody();
    // Find the specific line of code after which to insert the new code
    const sessionOnceCall = onAttachedToTargetMethod
      .getDescendantsOfKind(SyntaxKind.ExpressionStatement)
      .find((statement) =>
        statement
          .getText()
          .includes("session.once('Runtime.executionContextCreated'"),
      );
    // Insert the new lines of code after the found line
    const block = sessionOnceCall.getParentIfKindOrThrow(SyntaxKind.Block);
    block.insertStatements(sessionOnceCall.getChildIndex() + 1, `
      var globalThis = await session._sendMayFail('Runtime.evaluate', {
        expression: "globalThis",
        serializationOptions: { serialization: "idOnly" }
      });
      if (globalThis && globalThis.result) {
        var globalThisObjId = globalThis.result.objectId;
        var executionContextId = parseInt(globalThisObjId.split('.')[1], 10);
        worker.createExecutionContext(new CRExecutionContext(session, { id: executionContextId }));
      }
    `);
    // Find the specific statement to remove
    const runtimeStatementToRemove = onAttachedToTargetMethodBody
      .getStatements()
      .find((statement) =>
        statement.getText().includes("session._sendMayFail('Runtime.enable');"),
      );
    if (runtimeStatementToRemove) runtimeStatementToRemove.remove();

    // -- _onBindingCalled Method --
    const onBindingCalledMethod = frameSessionClass.getMethod("_onBindingCalled");
    // Find the specific if statement
    const ifStatement = onBindingCalledMethod
      .getDescendantsOfKind(SyntaxKind.IfStatement)
      .find(
        (statement) =>
          statement.getExpression().getText() === "context" &&
          statement
            .getThenStatement()
            .getText()
            .includes("await this._page._onBindingCalled(event.payload, context)"),
      );
    if (ifStatement) {
      // Modify the if statement to include the else clause
      ifStatement.replaceWithText(`
        if (context) await this._page._onBindingCalled(event.payload, context);
        else await this._page._onBindingCalled(event.payload, (await this._page.mainFrame()._mainContext())) // This might be a bit sketchy but it works for now
    `);
    }

    // -- _evaluateOnNewDocument Method --
    frameSessionClass
      .getMethod("_evaluateOnNewDocument")
      .setBodyText(`this._evaluateOnNewDocumentScripts.push(initScript)`);

    // -- _removeEvaluatesOnNewDocument Method --
    frameSessionClass
      .getMethod("_removeEvaluatesOnNewDocument")
      .setBodyText(`this._evaluateOnNewDocumentScripts = [];`);

    // -- _adoptBackendNodeId Method --
    const adoptBackendNodeIdMethod = frameSessionClass.getMethod("_adoptBackendNodeId");
    // Find the specific await expression containing the executionContextId property
    const variableStatement = adoptBackendNodeIdMethod
      .getVariableStatements()
      .find(
        (statement) =>
          statement
            .getText()
            .includes(
              "const result = await this._client._sendMayFail('DOM.resolveNode'",
            ) &&
          statement
            .getText()
            .includes(
              "executionContextId: ((to as any)[contextDelegateSymbol] as CRExecutionContext)._contextId",
            ),
      );
    if (variableStatement) {
      // Find the executionContextId property assignment and modify it
      const executionContextIdAssignment = variableStatement
        .getDescendantsOfKind(SyntaxKind.PropertyAssignment)
        .find((assignment) => assignment.getName() === "executionContextId");
      if (executionContextIdAssignment) {
        // Replace the initializer with the new one
        executionContextIdAssignment.setInitializer("to.delegate._contextId");
      }
    }
}