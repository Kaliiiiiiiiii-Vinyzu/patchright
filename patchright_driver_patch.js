import { Project, SyntaxKind, IndentationText } from "ts-morph";

const project = new Project({
  manipulationSettings: {
    indentationText: IndentationText.TwoSpaces,
  },
});

// ----------------------------
// server/browserContext.ts
// ----------------------------
const browserContextSourceFile = project.addSourceFileAtPath(
  "packages/playwright-core/src/server/browserContext.ts",
);
// ------- BrowserContext Class -------
const browserContextClass = browserContextSourceFile.getClass("BrowserContext");
// -- _initialize Method --
const initializeMethod = browserContextClass.getMethod("_initialize");
// Getting the service worker registration call
const initializeMethodCall = initializeMethod
  .getDescendantsOfKind(SyntaxKind.CallExpression)
  .find((call) => {
    return (
      call.getExpression().getText().includes("addInitScript") &&
      call
        .getArguments()
        .some((arg) =>
          arg.getText().includes("navigator.serviceWorker.register"),
        )
    );
  });
// Replace the service worker registration call with a custom one, which is less obvious
initializeMethodCall
  .getArguments()[0]
  .replaceWithText("`navigator.serviceWorker.register = async () => { };`");

// -- exposeBinding Method --
const exposeBindingMethod = browserContextClass.getMethod("exposeBinding");
// Remove old loop and logic for localFrames and isolated world creation
exposeBindingMethod.getStatements().forEach((statement) => {
  const text = statement.getText();
  // Check if the statement matches the patterns
  if (text.includes("this.doAddInitScript(binding.initScript)"))
    statement.replaceWithText("await this.doExposeBinding(binding);");
  else if (
    text.includes("this.pages().map(page => page.frames()).flat()") ||
    text.includes("frame.evaluateExpression(binding.initScript.source)")
  )
    statement.remove();
});

// -- _removeExposedBindings Method --
const removeExposedBindingsMethod = browserContextClass.getMethod(
  "_removeExposedBindings",
);
removeExposedBindingsMethod.setBodyText(`for (const key of this._pageBindings.keys()) {
  if (!key.startsWith('__pw'))
    this._pageBindings.delete(key);
}
await this.doRemoveExposedBindings();`);

// -- _removeInitScripts Method --
const removeInitScriptsMethod =
  browserContextClass.getMethod("_removeInitScripts");
removeInitScriptsMethod.setBodyText(`this.initScripts.splice(0, this.initScripts.length);
await this.doRemoveInitScripts();`);

// ----------------------------
// server/chromium/chromium.ts
// ----------------------------
const chromiumSourceFile = project.addSourceFileAtPath(
  "packages/playwright-core/src/server/chromium/chromium.ts",
);
// ------- Chromium Class -------
const chromiumClass = chromiumSourceFile.getClass("Chromium");
// -- _innerDefaultArgs Method --
const innerDefaultArgsMethod = chromiumClass.getMethod("_innerDefaultArgs");
// Get all the if statements in the method
const innerDefaultArgsMethodStatements =
  innerDefaultArgsMethod.getDescendantsOfKind(SyntaxKind.IfStatement);
// Modifying the Code to always use the --headless=new flag
innerDefaultArgsMethodStatements.forEach((ifStatement) => {
  const condition = ifStatement.getExpression().getText();
  if (condition.includes("process.env.PLAYWRIGHT_CHROMIUM_USE_HEADLESS_NEW")) {
    ifStatement.replaceWithText("chromeArguments.push('--headless=new');");
  }
});

// ----------------------------
// server/chromium/chromiumSwitches.ts
// ----------------------------
const chromiumSwitchesSourceFile = project.addSourceFileAtPath(
  "packages/playwright-core/src/server/chromium/chromiumSwitches.ts",
);
// -- chromiumSwitches Array Variable --
const chromiumSwitchesArray = chromiumSwitchesSourceFile
  .getVariableDeclarationOrThrow("chromiumSwitches")
  .getInitializerIfKindOrThrow(SyntaxKind.ArrayLiteralExpression);

const switchesToDisable = [
    "'--enable-automation'",
    "'--disable-popup-blocking'",
    "'--disable-component-update'",
    "'--disable-default-apps'",
    "'--disable-extensions'",
    "'--disable-client-side-phishing-detection'",
    "'--disable-component-extensions-with-background-pages'",
    "'--allow-pre-commit-input'",
    "'--disable-ipc-flooding-protection'",
    "'--metrics-recording-only'",
    "'--unsafely-disable-devtools-self-xss-warnings'",
    "'--disable-back-forward-cache'",
    "'--disable-features=ImprovedCookieControls,LazyFrameLoading,GlobalMediaControls,DestroyProfileOnBrowserClose,MediaRouter,DialMediaRouteProvider,AcceptCHFrame,AutoExpandDetailsElement,CertificateTransparencyComponentUpdater,AvoidUnnecessaryBeforeUnloadCheckSync,Translate,HttpsUpgrades,PaintHolding,ThirdPartyStoragePartitioning,LensOverlay,PlzDedicatedWorker'"
];
chromiumSwitchesArray.getElements().forEach((element) => {
  if (switchesToDisable.includes(element.getText())) {
    chromiumSwitchesArray.removeElement(element);
  }
});
// Add custom switches to the array
chromiumSwitchesArray.addElement(
  `'--disable-blink-features=AutomationControlled'`,
);

// ----------------------------
// server/chromium/crBrowser.ts
// ----------------------------
const crBrowserSourceFile = project.addSourceFileAtPath(
  "packages/playwright-core/src/server/chromium/crBrowser.ts",
);
// ------- CRDevTools Class -------
const crBrowserContextClass = crBrowserSourceFile.getClass("CRBrowserContext");
// -- doRemoveNonInternalInitScripts Method --
crBrowserContextClass.getMethod("doRemoveNonInternalInitScripts").remove();
// -- doRemoveInitScripts Method --
// crBrowserContextClass.addMethod({
//   name: "doRemoveInitScripts",
//   scope: "protected",
//   isAbstract: true,
//   returnType: "Promise<void>",
// });
// -- doExposeBinding Method --
//crBrowserContextClass.addMethod({
//  name: "doExposeBinding",
//  scope: "protected",
//  isAbstract: true,
//  parameters: [{ name: "binding", type: "PageBinding" }],
//  returnType: "Promise<void>",
//});
// -- doRemoveExposedBindings Method --
//crBrowserContextClass.addMethod({
//  name: "doRemoveExposedBindings",
//  scope: "protected",
//  isAbstract: true,
//  returnType: "Promise<void>",
//});

// -- doRemoveInitScripts Method --
crBrowserContextClass.addMethod({
  name: "doRemoveInitScripts",
  isAsync: true,
});
const doRemoveInitScriptsMethod = crBrowserContextClass.getMethod(
  "doRemoveInitScripts",
);
doRemoveInitScriptsMethod.setBodyText(
  `for (const page of this.pages()) await (page._delegate as CRPage).removeInitScripts();`,
);

// ------- Class -------
const crBrowserClass = crBrowserSourceFile.getClass("CRBrowserContext");
// -- doExposeBinding Method --
crBrowserClass.addMethod({
  name: "doExposeBinding",
  isAsync: true,
  parameters: [{ name: "binding", type: "PageBinding" }],
});
const doExposeBindingMethod = crBrowserClass.getMethod("doExposeBinding");
doExposeBindingMethod.setBodyText(
  `for (const page of this.pages()) await (page._delegate as CRPage).exposeBinding(binding);`,
);

// -- doRemoveExposedBindings Method --
crBrowserClass.addMethod({
  name: "doRemoveExposedBindings",
  isAsync: true,
});
const doRemoveExposedBindingsMethod = crBrowserClass.getMethod(
  "doRemoveExposedBindings",
);
doRemoveExposedBindingsMethod.setBodyText(
  `for (const page of this.pages()) await (page._delegate as CRPage).removeExposedBindings();`,
);

// ----------------------------
// server/chromium/crDevTools.ts
// ----------------------------
const crDevToolsSourceFile = project.addSourceFileAtPath(
  "packages/playwright-core/src/server/chromium/crDevTools.ts",
);
// ------- CRDevTools Class -------
const crDevToolsClass = crDevToolsSourceFile.getClass("CRDevTools");
// -- Install Method --
const installMethod = crDevToolsClass.getMethod("install");
// Find the specific `Promise.all` call
const promiseAllCalls = installMethod
  .getDescendantsOfKind(SyntaxKind.CallExpression)
  .filter((call) => call.getExpression().getText() === "Promise.all");
// Removing Runtime.enable from the Promise.all call
promiseAllCalls.forEach((call) => {
  const arrayLiteral = call.getFirstDescendantByKind(
    SyntaxKind.ArrayLiteralExpression,
  );
  if (arrayLiteral) {
    arrayLiteral.getElements().forEach((element) => {
      if (element.getText().includes("session.send('Runtime.enable'")) {
        arrayLiteral.removeElement(element);
      }
    });
  }
});

// ----------------------------
// server/chromium/crNetworkManager.ts
// ----------------------------
const crNetworkManagerSourceFile = project.addSourceFileAtPath(
  "packages/playwright-core/src/server/chromium/crNetworkManager.ts",
);
// Add the custom import and comment at the start of the file
crNetworkManagerSourceFile.insertStatements(0, [
  "// undetected-undetected_playwright-patch - custom imports",
  "import crypto from 'crypto';",
  "",
]);

// ------- CRNetworkManager Class -------
const crNetworkManagerClass =
  crNetworkManagerSourceFile.getClass("CRNetworkManager");
// -- _onRequest Method --
const onRequestMethod = crNetworkManagerClass.getMethod("_onRequest");
// Find the assignment statement you want to modify
const routeAssignment = onRequestMethod
  .getDescendantsOfKind(SyntaxKind.BinaryExpression)
  .find((expr) =>
    expr
      .getText()
      .includes(
        "route = new RouteImpl(requestPausedSessionInfo!.session, requestPausedEvent.requestId)",
      ),
  );
// Adding new parameter to the RouteImpl call
if (routeAssignment) {
  routeAssignment
    .getRight()
    .replaceWithText(
      "new RouteImpl(requestPausedSessionInfo!.session, requestPausedEvent.requestId, this._page)",
    );
}

// -- _updateProtocolRequestInterceptionForSession Method --
const updateProtocolRequestInterceptionForSessionMethod = crNetworkManagerClass.getMethod("_updateProtocolRequestInterceptionForSession");
// Remove old loop and logic for localFrames and isolated world creation
updateProtocolRequestInterceptionForSessionMethod.getStatements().forEach((statement) => {
  const text = statement.getText();
  // Check if the statement matches the patterns
  if (text.includes('const cachePromise = info.session.send(\'Network.setCacheDisabled\', { cacheDisabled: enabled });'))
    statement.replaceWithText('const cachePromise = info.session.send(\'Network.setCacheDisabled\', { cacheDisabled: false });');
});

// ------- RouteImpl Class -------
const routeImplClass = crNetworkManagerSourceFile.getClass("RouteImpl");
// -- RouteImpl Constructor --
const constructorDeclaration = routeImplClass
  .getConstructors()
  .find((ctor) =>
    ctor
      .getText()
      .includes("constructor(session: CRSession, interceptionId: string)"),
  );
if (constructorDeclaration) {
  // Get current parameters and add the new `page` parameter
  const parameters = constructorDeclaration.getParameters();
  // Adding the 'page' parameter
  constructorDeclaration.insertParameter(parameters.length, {
    name: "page",
    type: "Page", // Replace with the actual type of 'page' if different
  });
  // Modify the constructor's body to include `this._page = page;`
  const body = constructorDeclaration.getBody();
  // Insert `this._page = void 0;`
  body.insertStatements(0, "this._page = void 0;");
  // Insert `this._page = page;` at the end of the constructor body
  body.addStatements("this._page = page;");
  // Inject HTML code
  const fulfillMethod = routeImplClass.getMethodOrThrow("fulfill");
  const methodBody = fulfillMethod.getBodyOrThrow();
  // Insert the custom code at the beginning of the `fulfill` method
  const customHTMLInjectCode = `const isTextHtml = response.headers.some(header => header.name === 'content-type' && header.value.includes('text/html'));
  var allInjections = [...this._page._delegate._mainFrameSession._evaluateOnNewDocumentScripts];
      for (const binding of this._page._delegate._browserContext._pageBindings.values()) {
        if (!allInjections.includes(binding)) allInjections.push(binding);
      }
  if (isTextHtml && allInjections.length) {
    // I Chatted so hard for this Code
    let scriptNonce = crypto.randomBytes(22).toString('hex');
    for (let i = 0; i < response.headers.length; i++) {
      if (response.headers[i].name === 'content-security-policy' || response.headers[i].name === 'content-security-policy-report-only') {
        // Search for an existing script-src nonce that we can hijack
        let cspValue = response.headers[i].value;
        const nonceRegex = /script-src[^;]*'nonce-([\\w-]+)'/;
        const nonceMatch = cspValue.match(nonceRegex);
        if (nonceMatch) {
          scriptNonce = nonceMatch[1];
        } else {
          // Add the new nonce value to the script-src directive
          const scriptSrcRegex = /(script-src[^;]*)(;|$)/;
          const newCspValue = cspValue.replace(scriptSrcRegex, \`$1 'nonce-\${scriptNonce}'$2\`);
          response.headers[i].value = newCspValue;
        }
        break;
      }
    }
    let injectionHTML = "";
    allInjections.forEach((script) => {
      injectionHTML += \`<script class="\${this._page._delegate.initScriptTag}" nonce="\${scriptNonce}" type="text/javascript">\${script.source}</script>\`;
    });
    if (response.isBase64) {
      response.isBase64 = false;
      response.body = injectionHTML + Buffer.from(response.body, 'base64').toString('utf-8');
    } else {
      response.body = injectionHTML + response.body;
    }
  }`;
  methodBody.insertStatements(0, customHTMLInjectCode);
}

// ----------------------------
// server/chromium/crServiceWorker.ts
// ----------------------------
const crServiceWorkerSourceFile = project.addSourceFileAtPath(
  "packages/playwright-core/src/server/chromium/crServiceWorker.ts",
);
// ------- CRServiceWorker Class -------
const crServiceWorkerClass =
  crServiceWorkerSourceFile.getClass("CRServiceWorker");
// -- CRServiceWorker Constructor --
const crServiceWorkerConstructorDeclaration = crServiceWorkerClass
  .getConstructors()
  .find((ctor) =>
    ctor
      .getText()
      .includes(
        "constructor(browserContext: CRBrowserContext, session: CRSession, url: string)",
      ),
  );
const crServiceWorkerConstructorBody =
  crServiceWorkerConstructorDeclaration.getBody();
// Find the Runtime.enable statement to remove
const statementToRemove = crServiceWorkerConstructorBody
  .getStatements()
  .find((statement) =>
    statement
      .getText()
      .includes("session.send('Runtime.enable', {}).catch(e => { });"),
  );
if (statementToRemove) statementToRemove.remove();

// ----------------------------
// server/frames.ts
// ----------------------------
const framesSourceFile = project.addSourceFileAtPath(
  "packages/playwright-core/src/server/frames.ts",
);
// Add the custom import and comment at the start of the file
framesSourceFile.insertStatements(0, [
  "// undetected-undetected_playwright-patch - custom imports",
  "import { CRExecutionContext } from './chromium/crExecutionContext';",
  "import { FrameExecutionContext } from './dom';",
  "import crypto from 'crypto';",
  "",
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

// -- _onClearLifecycle Method --
const onClearLifecycleMethod = frameClass.getMethod("_onClearLifecycle");
// Modify the constructor's body to include unassignments
const onClearLifecycleBody = onClearLifecycleMethod.getBody();
onClearLifecycleBody.insertStatements(0, "this._iframeWorld = undefined;");
onClearLifecycleBody.insertStatements(0, "this._mainWorld = undefined;");
onClearLifecycleBody.insertStatements(0, "this._isolatedWorld = undefined;");

// -- _getFrameMainFrameContextId Method --
// Define the getFrameMainFrameContextIdCode
/*const getFrameMainFrameContextIdCode = `var globalDocument = await client._sendMayFail('DOM.getFrameOwner', { frameId: this._id });
  if (globalDocument && globalDocument.nodeId) {
    for (const executionContextId of this._page._delegate._sessionForFrame(this)._parsedExecutionContextIds) {
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
const getFrameMainFrameContextIdCode = `try {
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
    return 0;`;

// Add the method to the class
frameClass.addMethod({
  name: "_getFrameMainFrameContextId",
  isAsync: true,
  parameters: [
    {
      name: "client",
    },
  ],
  returnType: "Promise<number>",
});
const getFrameMainFrameContextIdMethod = frameClass.getMethod(
  "_getFrameMainFrameContextId",
);
getFrameMainFrameContextIdMethod.setBodyText(
  getFrameMainFrameContextIdCode.trim(),
);

// -- _context Method --
const contextMethodCode = `
    /* await this._page._delegate._mainFrameSession._client._sendMayFail('DOM.enable');
    var globalDoc = await this._page._delegate._mainFrameSession._client._sendMayFail('DOM.getFrameOwner', { frameId: this._id });
    if (globalDoc) {
      await this._page._delegate._mainFrameSession._client._sendMayFail("DOM.resolveNode", { nodeId: globalDoc.nodeId })
    } */

    // if (this.isDetached()) throw new Error('Frame was detached');
    try {
      var client = this._page._delegate._sessionForFrame(this)._client
    } catch (e) { var client = this._page._delegate._mainFrameSession._client }
    var iframeExecutionContextId = await this._getFrameMainFrameContextId(client)

    if (world == "main") {
      // Iframe Only
      if (this != this._page.mainFrame() && iframeExecutionContextId && this._iframeWorld == undefined) {
        var executionContextId = iframeExecutionContextId
        var crContext = new CRExecutionContext(client, { id: executionContextId }, this._id)
        this._iframeWorld = new FrameExecutionContext(crContext, this, world)
        this._page._delegate._mainFrameSession._onExecutionContextCreated({
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
        this._page._delegate._mainFrameSession._onExecutionContextCreated({
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
      this._page._delegate._mainFrameSession._onExecutionContextCreated({
        id: executionContextId, origin: world, name: world, auxData: { isDefault: this === this._page.mainFrame(), type: 'isolated', frameId: this._id }
      })
    }

    if (world != "main") {
      return this._isolatedWorld;
    } else if (this != this._page.mainFrame() && iframeExecutionContextId) {
      return this._iframeWorld;
    } else {
      return this._mainWorld;
    }`;
const contextMethod = frameClass.getMethod("_context");
contextMethod.setIsAsync(true);
contextMethod.setBodyText(contextMethodCode.trim());

// -- _setContext Method --
const setContentMethod = frameClass.getMethod("setContent");
// Locate the existing line of code
const existingLine = setContentMethod
  .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
  .find((variableDeclaration) =>
    variableDeclaration
      .getText()
      .includes(
        "--playwright--set--content--${this._id}--${++this._setContentCounter}--`",
      ),
  );
// Get the position to insert the new line after
const position = existingLine.getEnd();
// Insert the new line after the existing line
setContentMethod.insertText(
  position + 1,
  "\n        const bindingName = \"_tagDebug\" + crypto.randomBytes(20).toString('hex');",
);
// Find the evaluate call expression
const evaluateCall = setContentMethod
  .getDescendantsOfKind(SyntaxKind.CallExpression)
  .find(
    (callExpr) => callExpr.getExpression().getText() === "context.evaluate",
  );
if (evaluateCall) {
  const arrowFunction = evaluateCall.getArguments()[0];
  const objectArg = evaluateCall.getArguments()[1];

  // Ensure the arrow function and object argument are what we expect
  if (
    arrowFunction?.getKind() === SyntaxKind.ArrowFunction &&
    objectArg?.getKind() === SyntaxKind.ObjectLiteralExpression
  ) {
    const arrowFunctionBody = arrowFunction.getBody();

    if (arrowFunctionBody?.getKind() === SyntaxKind.Block) {
      const block = arrowFunctionBody.asKind(SyntaxKind.Block);

      if (block) {
        // Add the new lines after document.open();
        block.insertStatements(1, [
          "var _tagDebug = window[bindingName].bind({});",
          "delete window[bindingName]",
          '_tagDebug(\'{ "name": "\' + bindingName + \'", "seq": 1, "serializedArgs": ["\' + tag + \'"] }\');',
        ]);

        // Replace the destructured parameters in the arrow function
        const paramsText = arrowFunction.getParameters()[0].getText();
        const updatedParamsText = paramsText.replace(
          "{ html, tag }",
          "{ html, tag, bindingName }",
        );
        arrowFunction.getParameters()[0].replaceWithText(updatedParamsText);

        // Add bindingName to the object literal passed to evaluate
        objectArg.addProperty("bindingName");
      }
    }
  }
}
const oldCode = `const lifecyclePromise = new Promise((resolve, reject) => {
                      this._page._frameManager._consoleMessageTags.set(tag, () => {
                        // Clear lifecycle right after document.open() - see 'tag' below.
                        this._onClearLifecycle();
                        this._waitForLoadState(progress, waitUntil).then(resolve).catch(reject);
                      });
              });`.replace(/  +/g, "");
const newCode = `        await this._page._delegate._mainFrameSession._client.send('Runtime.addBinding', { name: bindingName });
        const lifecyclePromise = new Promise(async (resolve, reject) => {
          await this._page.exposeBinding(bindingName, false, (tag) => {
            this._onClearLifecycle();
            this._waitForLoadState(progress, waitUntil).then(resolve).catch(reject);
          });
        });`;

// Get the method's text and replace old code with new code
const methodText = setContentMethod.getText();
const unindentedMethodText = setContentMethod.getText().replace(/  +/g, "");
const updatedText = unindentedMethodText.replace(oldCode, newCode);
let newMethodText = "";
// Iterate through each line of the method's text and get the same line from the updated text
methodText.split("\n").forEach((line, index) => {
  const updatedLine = updatedText.split("\n")[index];
  if (line.replace(/  +/g, "") != updatedLine) {
    // If the lines are different, add the updated line to the new method text
    newMethodText += updatedLine + "\n";
  } else {
    // Otherwise, add the original line to the new method text
    newMethodText += line + "\n";
  }
});
// Update the method's text
setContentMethod.replaceWithText(newMethodText);

// ----------------------------
// server/chromium/crPage.ts
// ----------------------------
const crPageSourceFile = project.addSourceFileAtPath(
  "packages/playwright-core/src/server/chromium/crPage.ts",
);
// Add the custom import and comment at the start of the file
crPageSourceFile.insertStatements(0, [
  "// undetected-undetected_playwright-patch - custom imports",
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
this.initScriptTag = "injected-playwright-init-script-" + crypto.randomBytes(20).toString('hex');`);
}

// -- exposeBinding Method --
crPageClass.addMethod({
  name: "exposeBinding",
  isAsync: true,
  parameters: [
    {
      name: "binding",
    },
  ],
});
const crExposeBindingMethod = crPageClass.getMethod("exposeBinding");
crExposeBindingMethod.setBodyText(
  `await this._forAllFrameSessions(frame => frame._initBinding(binding));
await Promise.all(this._page.frames().map(frame => frame.evaluateExpression(binding.source).catch(e => {})));`,
);

// -- removeExposedBindings Method --
crPageClass.addMethod({
  name: "removeExposedBindings",
  isAsync: true,
});
const crRemoveExposedBindingsMethod = crPageClass.getMethod(
  "removeExposedBindings",
);
crRemoveExposedBindingsMethod.setBodyText(
  `await this._forAllFrameSessions(frame => frame._removeExposedBindings());`,
);

// -- removeNonInternalInitScripts Method --
crPageClass
  .getMethod("removeNonInternalInitScripts")
  .rename("removeInitScripts");

// -- addInitScript Method --
const addInitScriptMethod = crPageClass.getMethod("addInitScript");
const addInitScriptMethodBody = addInitScriptMethod.getBody();
// Insert a new line of code before the first statement
addInitScriptMethodBody.insertStatements(
  0,
  "this._page.initScripts.push(initScript);",
);

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
const addRendererListenersMethod = frameSessionClass.getMethod(
  "_addRendererListeners",
);
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
// Find the variable declaration
const variableName = "promises"; // The name of the variable to find
const variableDeclaration =
  initializeFrameSessionMethod.getVariableDeclarationOrThrow(variableName);
// Find the initializer array
const initializer = variableDeclaration.getInitializerIfKindOrThrow(
  SyntaxKind.ArrayLiteralExpression,
);
// Find the relevant element inside the array that we need to update
initializer.getElements().forEach((element) => {
  if (
    element.getText().includes("this._client.send('Runtime.enable'") ||
    element
      .getText()
      .includes(
        "this._client.send('Runtime.addBinding', { name: PageBinding.kPlaywrightBinding })",
      )
  ) {
    initializer.removeElement(element);
  }
});
// Find the relevant element inside the array that we need to update
const pageGetFrameTreeCall = initializer
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
    elseStatement.insertStatements(
      0,
      `const localFrames = this._isMainFrame() ? this._page.frames() : [this._page._frameManager.frame(this._targetId)!];
for (const frame of localFrames) {
  this._page._frameManager.frame(frame._id)._context("utility");
  for (const binding of this._crPage._browserContext._pageBindings.values())
    frame.evaluateExpression(binding.source).catch(e => {});
  for (const source of this._crPage._browserContext.initScripts)
    frame.evaluateExpression(source).catch(e => {});
}`,
    );
  }
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
        statement.replaceWithText(`for (const binding of this._crPage._browserContext._pageBindings.values()) frame.evaluateExpression(binding.source).catch(e => {});
for (const initScript of this._crPage._browserContext.initScripts) frame.evaluateExpression(initScript.source).catch(e => {});`);
      } else if (
        statement
          .getText()
          .includes("this._evaluateOnNewDocument(initScript, 'main')")
      ) {
        statement.replaceWithText(`for (const binding of this._crPage._page.allBindings()) promises.push(this._initBinding(binding));
for (const initScript of this._crPage._browserContext.initScripts) promises.push(this._evaluateOnNewDocument(initScript, 'main'));
for (const initScript of this._crPage._page.initScripts) promises.push(this._evaluateOnNewDocument(initScript, 'main'));`);
      }
    }
  });
// Find the statement `promises.push(this._client.send('Runtime.runIfWaitingForDebugger'))`
const promisePushStatements = initializeFrameSessionMethodBody
  .getStatements()
  .filter((statement) =>
    statement
      .getText()
      .includes(
        "promises.push(this._client.send('Runtime.runIfWaitingForDebugger'))",
      ),
  );
// Ensure the right statements were found
if (promisePushStatements.length === 1) {
  const [firstStatement] = promisePushStatements;
  // Replace the first `promises.push` statement with the new conditional code
  firstStatement.replaceWithText(
    `if (!(this._crPage._page._pageBindings.size || this._crPage._browserContext._pageBindings.size)) promises.push(this._client.send('Runtime.runIfWaitingForDebugger'));`,
  );
  initializeFrameSessionMethodBody.addStatements(
    `if (this._crPage._page._pageBindings.size || this._crPage._browserContext._pageBindings.size) await this._client.send('Runtime.runIfWaitingForDebugger');`,
  );
}

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
initBindingMethod.setBodyText(`var result = await this._client._sendMayFail('Page.createIsolatedWorld', {
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
await this._crPage.addInitScript(binding.source);
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
await Promise.all(toRemove.map(name => this._client.send('Runtime.removeBinding', { name })));`);

// -- _navigate Method --
const navigateMethod = frameSessionClass.getMethod("_navigate");
const navigateMethodBody = navigateMethod.getBody();
// Insert the new line of code after the responseAwaitStatement
navigateMethodBody.insertStatements(
  1,
  `this._client._sendMayFail('Page.waitForDebugger');`,
);

// -- _onLifecycleEvent & _onFrameNavigated Method --
for (const methodName of ["_onLifecycleEvent", "_onFrameNavigated"]) {
  const frameSessionMethod = frameSessionClass.getMethod(methodName);
  const frameSessionMethodBody = frameSessionMethod.getBody();
  frameSessionMethod.setIsAsync(true);
  frameSessionMethodBody.addStatements(`var document = await this._client._sendMayFail("DOM.getDocument");
  if (!document) return
  var query = await this._client._sendMayFail("DOM.querySelectorAll", {
    nodeId: document.root.nodeId,
    selector: "[class=" + this._crPage.initScriptTag + "]"
  });
  if (!query) return
  for (const nodeId of query.nodeIds) await this._client._sendMayFail("DOM.removeNode", { nodeId: nodeId });
  await this._client._sendMayFail('Runtime.runIfWaitingForDebugger');
  // ensuring execution context
  try { await this._page._frameManager.frame(this._targetId)._context("utility") } catch { };`);
}

// -- _onExecutionContextCreated Method --
const onExecutionContextCreatedMethod = frameSessionClass.getMethod(
  "_onExecutionContextCreated",
);
const onExecutionContextCreatedMethodBody =
  onExecutionContextCreatedMethod.getBody();
onExecutionContextCreatedMethodBody.insertStatements(
  0,
  `for (const name of this._exposedBindingNames) this._client._sendMayFail('Runtime.addBinding', { name: name, executionContextId: contextPayload.id });`,
);
onExecutionContextCreatedMethodBody.insertStatements(
  2,
  `if (contextPayload.auxData.type == "worker") throw new Error("ExecutionContext is worker");`,
);
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
onExecutionContextCreatedMethodBody.addStatements(
  `for (const source of this._exposedBindingScripts) {
  this._client._sendMayFail("Runtime.evaluate", {
    expression: source,
    contextId: contextPayload.id,
    awaitPromise: true,
  })
}`,
);

// -- _onAttachedToTarget Method --
const onAttachedToTargetMethod = frameSessionClass.getMethod(
  "_onAttachedToTarget",
);
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
block.insertStatements(sessionOnceCall.getChildIndex() + 1, [
  `var globalThis = await session._sendMayFail('Runtime.evaluate', {`,
  `  expression: "globalThis",`,
  `  serializationOptions: { serialization: "idOnly" }`,
  `});`,
  `if (globalThis && globalThis.result) {`,
  `  var globalThisObjId = globalThis.result.objectId;`,
  `  var executionContextId = parseInt(globalThisObjId.split('.')[1], 10);`,
  `  worker._createExecutionContext(new CRExecutionContext(session, { id: executionContextId }));`, //NOTE: , this._id
  `}`,
]);
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
  ifStatement.replaceWithText(`if (context) await this._page._onBindingCalled(event.payload, context);
else await this._page._onBindingCalled(event.payload, (await this._page.mainFrame()._mainContext())) // This might be a bit sketchy but it works for now`);
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
const adoptBackendNodeIdMethod = frameSessionClass.getMethod(
  "_adoptBackendNodeId",
);
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
    executionContextIdAssignment.setInitializer("to._delegate._contextId");
  }
}

// ----------------------------
// server/page.ts
// ----------------------------
const pageSourceFile = project.addSourceFileAtPath(
  "packages/playwright-core/src/server/page.ts",
);

// ------- Page Class -------
const pageClass = pageSourceFile.getClass("Page");
// -- exposeBinding Method --
const pageExposeBindingMethod = pageClass.getMethod("exposeBinding");
pageExposeBindingMethod.getBodyOrThrow().forEachDescendant((node) => {
  // Check if the node is an expression statement that matches the line we want to replace.
  if (node.getKind() === SyntaxKind.ExpressionStatement) {
    const expressionText = node.getText();

    // Check if the line is the one we want to replace.
    if (expressionText.includes("await this._delegate.addInitScript")) {
      // Replace the line with the desired code.
      node.replaceWithText(`await this._delegate.exposeBinding(binding);`);
    } else if (expressionText.includes("await Promise.all(this.frames()"))
      node.remove();
  }
});

// -- _removeExposedBindings Method --
const pageRemoveExposedBindingsMethod = pageClass.getMethod(
  "_removeExposedBindings",
);
pageRemoveExposedBindingsMethod.setBodyText(`for (const key of this._pageBindings.keys()) {
  if (!key.startsWith('__pw'))
    this._pageBindings.delete(key);
}
await this._delegate.removeExposedBindings();`);

// -- _removeInitScripts Method --
const pageRemoveInitScriptsMethod = pageClass.getMethod("_removeInitScripts");
pageRemoveInitScriptsMethod.setBodyText(`this.initScripts.splice(0, this.initScripts.length);
await this._delegate.removeInitScripts();`);

// -- allInitScripts Method --
pageClass.getMethod("allInitScripts").remove();

// -- allBindings Method --
pageClass.addMethod({
  name: "allBindings",
});
const allBindingsMethod = pageClass.getMethod("allBindings");
allBindingsMethod.setBodyText(
  `return [...this._browserContext._pageBindings.values(), ...this._pageBindings.values()];`,
);

// ------- PageBinding Class -------
const pageBindingClass = pageSourceFile.getClass("PageBinding");
const kPlaywrightBindingProperty =
  pageBindingClass.getProperty("kPlaywrightBinding");
if (kPlaywrightBindingProperty) kPlaywrightBindingProperty.remove();
const initScriptProperty = pageBindingClass.getProperty("initScript");
if (initScriptProperty) initScriptProperty.remove();
pageBindingClass.addProperty({
  name: "source",
  type: "string",
  isReadonly: true,
});
// -- PageBinding Constructor --
const pageBindingConstructor = pageBindingClass.getConstructors()[0];
pageBindingConstructor.setBodyText(
  `this.name = name;
this.playwrightFunction = playwrightFunction;
this.source = ` +
    "`(${addPageBinding.toString()})(${JSON.stringify(name)}, ${needsHandle}, (${source})())`;" +
    `
this.needsHandle = needsHandle;`,
);

// ------- InitScript Class -------
const initScriptClass = pageSourceFile.getClass("InitScript");
// -- InitScript Constructor --
const initScriptConstructor = initScriptClass.getConstructors()[0];
const initScriptConstructorAssignment = initScriptConstructor
  .getBody()
  ?.getStatements()
  .find(
    (statement) =>
      statement.getKind() === SyntaxKind.ExpressionStatement &&
      statement.getText().includes("this.source = `(() => {"),
  );
// Remove unnecessary, detectable code from the constructor
if (initScriptConstructorAssignment) {
  initScriptConstructorAssignment.replaceWithText(
    `this.source = \`(() => { \${source} })();\`;`,
  );
}
// ------- addPageBinding Function -------
const addPageBindingFunction = pageSourceFile.getFunction("addPageBinding");
const parameters = addPageBindingFunction.getParameters();
parameters.forEach((param) => {
  if (param.getName() === "playwrightBinding") {
    param.remove();
  }
});
addPageBindingFunction.getStatements().forEach((statement) => {
  if (statement.getText().includes("(globalThis as any)[playwrightBinding]")) {
    // Replace the line with the new code.
    statement.replaceWithText(
      `const binding = (globalThis as any)[bindingName];
if (binding && binding.toString().startsWith("(...args) => {")) return`,
    );
  }
});

const statements = addPageBindingFunction.getBodyOrThrow().getStatements();
for (const statement of statements) {
  if (statement.getKind() === SyntaxKind.IfStatement) {
    const ifStatement = statement.asKindOrThrow(SyntaxKind.IfStatement);
    // Check if the if-statement is the one we're looking for
    const expressionText = ifStatement.getExpression().getText();
    if (expressionText === "binding.__installed") {
      ifStatement.remove();
    }
  }
  // Remove the assignment: (globalThis as any)[bindingName].__installed = true;
  if (statement.getKind() === SyntaxKind.ExpressionStatement) {
    const expressionStatement = statement.asKindOrThrow(
      SyntaxKind.ExpressionStatement,
    );
    const expressionText = expressionStatement.getExpression().getText();
    if (
      expressionText === "(globalThis as any)[bindingName].__installed = true"
    ) {
      expressionStatement.remove();
    }
  }
}
// ------- Worker Class -------
const workerClass = pageSourceFile.getClass("Worker");
// -- evaluateExpression Method --
const workerEvaluateExpressionMethod = workerClass.getMethod("evaluateExpression");
workerEvaluateExpressionMethod.addParameter({
    name: "isolatedContext",
    type: "boolean",
    hasQuestionToken: true,
});
const workerEvaluateExpressionMethodBody = workerEvaluateExpressionMethod.getBody();
workerEvaluateExpressionMethodBody.replaceWithText(
    workerEvaluateExpressionMethodBody.getText().replace(/await this\._executionContextPromise/g, "context")
);
// Insert the new line of code after the responseAwaitStatement
workerEvaluateExpressionMethodBody.insertStatements(
  0,
  `let context = await this._executionContextPromise;
  if (context.constructor.name === "FrameExecutionContext") {
      const frame = context.frame;
      if (frame) {
          if (isolatedContext) context = await frame._utilityContext();
          else if (!isolatedContext) context = await frame._mainContext();
      }
  }`,
);
// -- evaluateExpressionHandle Method --
const workerEvaluateExpressionHandleMethod = workerClass.getMethod("evaluateExpressionHandle");
workerEvaluateExpressionHandleMethod.addParameter({
    name: "isolatedContext",
    type: "boolean",
    hasQuestionToken: true,
});
const workerEvaluateExpressionHandleMethodBody = workerEvaluateExpressionHandleMethod.getBody();
workerEvaluateExpressionHandleMethodBody.replaceWithText(
    workerEvaluateExpressionHandleMethodBody.getText().replace(/await this\._executionContextPromise/g, "context")
);
// Insert the new line of code after the responseAwaitStatement
workerEvaluateExpressionHandleMethodBody.insertStatements(
  0,
  `let context = await this._executionContextPromise;
  if (this._context.constructor.name === "FrameExecutionContext") {
      const frame = this._context.frame;
      if (frame) {
          if (isolatedContext) context = await frame._utilityContext();
          else if (!isolatedContext) context = await frame._mainContext();
      }
  }`,
);

// ----------------------------
// server/clock.ts
// ----------------------------
const clockSourceFile = project.addSourceFileAtPath(
  "packages/playwright-core/src/server/clock.ts",
);

// ------- Page Class -------
const clockClass = clockSourceFile.getClass("Clock");
// -- exposeBinding Method --
const evaluateInFramesMethod = clockClass.getMethod("_evaluateInFrames");
// Modify the constructor's body to include Custom Code
const evaluateInFramesMethodBody = evaluateInFramesMethod.getBody();
evaluateInFramesMethodBody.insertStatements(
  0,
  `// Dont ask me why this works
await Promise.all(this._browserContext.pages().map(async page => {
  await Promise.all(page.frames().map(async frame => {
    try {
      await frame.evaluateExpression("");
    } catch (e) {}
  }));
}));`,
);

// ----------------------------
// server/javascript.ts
// ----------------------------
const javascriptSourceFile = project.addSourceFileAtPath(
  "packages/playwright-core/src/server/javascript.ts",
);

// -------JSHandle Class -------
const jsHandleClass = javascriptSourceFile.getClass("JSHandle");
// -- evaluateExpression Method --
const jsHandleEvaluateExpressionMethod = jsHandleClass.getMethod("evaluateExpression");
jsHandleEvaluateExpressionMethod.addParameter({
    name: "isolatedContext",
    type: "boolean",
    hasQuestionToken: true,
});
const jsHandleEvaluateExpressionMethodBody = jsHandleEvaluateExpressionMethod.getBody();
jsHandleEvaluateExpressionMethodBody.replaceWithText(
    jsHandleEvaluateExpressionMethodBody.getText().replace(/this\._context/g, "context")
);
// Insert the new line of code after the responseAwaitStatement
jsHandleEvaluateExpressionMethodBody.insertStatements(
  0,
  `let context = this._context;
  if (context.constructor.name === "FrameExecutionContext") {
      const frame = context.frame;
      if (frame) {
          if (isolatedContext) context = await frame._utilityContext();
          else if (!isolatedContext) context = await frame._mainContext();
      }
  }`,
);
// -- evaluateExpressionHandle Method --
const jsHandleEvaluateExpressionHandleMethod = jsHandleClass.getMethod("evaluateExpressionHandle");
jsHandleEvaluateExpressionHandleMethod.addParameter({
    name: "isolatedContext",
    type: "boolean",
    hasQuestionToken: true,
});
const jsHandleEvaluateExpressionHandleMethodBody = jsHandleEvaluateExpressionHandleMethod.getBody();
jsHandleEvaluateExpressionHandleMethodBody.replaceWithText(
    jsHandleEvaluateExpressionHandleMethodBody.getText().replace(/this\._context/g, "context")
);
// Insert the new line of code after the responseAwaitStatement
jsHandleEvaluateExpressionHandleMethodBody.insertStatements(
  0,
  `let context = this._context;
  if (this._context.constructor.name === "FrameExecutionContext") {
      const frame = this._context.frame;
      if (frame) {
          if (isolatedContext) context = await frame._utilityContext();
          else if (!isolatedContext) context = await frame._mainContext();
      }
  }`,
);

// ----------------------------
// server/dispatchers/frameDispatcher.ts
// ----------------------------
const frameDispatcherSourceFile = project.addSourceFileAtPath(
  "packages/playwright-core/src/server/dispatchers/frameDispatcher.ts",
);
// ------- frameDispatcher Class -------
const frameDispatcherClass = frameDispatcherSourceFile.getClass("FrameDispatcher");
// -- evaluateExpression Method --
const frameEvaluateExpressionMethod = frameDispatcherClass.getMethod("evaluateExpression");
const frameEvaluateExpressionReturn = frameEvaluateExpressionMethod.getFirstDescendantByKind(SyntaxKind.ReturnStatement);
const frameEvaluateExpressionCall = frameEvaluateExpressionReturn.getFirstDescendantByKind(SyntaxKind.CallExpression).getFirstDescendantByKind(SyntaxKind.CallExpression);
// add isolatedContext Bool Param
if (frameEvaluateExpressionCall && frameEvaluateExpressionCall.getExpression().getText().includes("this._frame.evaluateExpression")) {
      // Add the new argument to the function call
      // frameEvaluateExpressionCall.addArgument("params.isolatedContext");

      // Get the second argument (which is an object: { isFunction: params.isFunction })
      const secondArg = frameEvaluateExpressionCall.getArguments()[1];
      if (secondArg && secondArg.getKind() === SyntaxKind.ObjectLiteralExpression) {
            // Add the executionContext property
            secondArg.addPropertyAssignment({
              name: "world",
              initializer: "params.isolatedContext ? 'utility': 'main'"
            });
      }
}
// -- evaluateExpressionHandle Method --
const frameEvaluateExpressionHandleMethod = frameDispatcherClass.getMethod("evaluateExpressionHandle");
const frameEvaluateExpressionHandleReturn = frameEvaluateExpressionHandleMethod.getFirstDescendantByKind(SyntaxKind.ReturnStatement);
const frameEvaluateExpressionHandleCall = frameEvaluateExpressionHandleReturn.getFirstDescendantByKind(SyntaxKind.CallExpression).getFirstDescendantByKind(SyntaxKind.CallExpression);
// add isolatedContext Bool Param
if (frameEvaluateExpressionHandleCall && frameEvaluateExpressionHandleCall.getExpression().getText().includes("this._frame.evaluateExpression")) {
      // Add the new argument to the function call
      //frameEvaluateExpressionHandleCall.addArgument("params.isolatedContext");

      // Get the second argument (which is an object: { isFunction: params.isFunction })
      const secondArg = frameEvaluateExpressionHandleCall.getArguments()[1];
      if (secondArg && secondArg.getKind() === SyntaxKind.ObjectLiteralExpression) {
            // Add the executionContext property
            secondArg.addPropertyAssignment({
              name: "world",
              initializer: "params.isolatedContext ? 'utility': 'main'"
            });
      }
}

// ----------------------------
// server/dispatchers/jsHandleDispatcher.ts
// ----------------------------
const jsHandleDispatcherSourceFile = project.addSourceFileAtPath(
  "packages/playwright-core/src/server/dispatchers/jsHandleDispatcher.ts",
);
// ------- workerDispatcher Class -------
const jsHandleDispatcherClass = jsHandleDispatcherSourceFile.getClass("JSHandleDispatcher");
// -- evaluateExpression Method --
const jsHandleDispatcherEvaluateExpressionMethod = jsHandleDispatcherClass.getMethod("evaluateExpression");
const jsHandleDispatcherEvaluateExpressionReturn = jsHandleDispatcherEvaluateExpressionMethod.getFirstDescendantByKind(SyntaxKind.ReturnStatement);
const jsHandleDispatcherEvaluateExpressionCall = jsHandleDispatcherEvaluateExpressionReturn.getFirstDescendantByKind(SyntaxKind.CallExpression).getFirstDescendantByKind(SyntaxKind.CallExpression);
// add isolatedContext Bool Param
if (jsHandleDispatcherEvaluateExpressionCall && jsHandleDispatcherEvaluateExpressionCall.getExpression().getText().includes("this._object.evaluateExpression")) {
      // Add the new argument to the function call
      jsHandleDispatcherEvaluateExpressionCall.addArgument("params.isolatedContext");
}
// -- evaluateExpressionHandle Method --
const jsHandleDispatcherEvaluateExpressionHandleMethod = jsHandleDispatcherClass.getMethod("evaluateExpressionHandle");
const jsHandleDispatcherEvaluateExpressionHandleCall = jsHandleDispatcherEvaluateExpressionHandleMethod.getFirstDescendantByKind(SyntaxKind.CallExpression);
// add isolatedContext Bool Param
if (jsHandleDispatcherEvaluateExpressionHandleCall && jsHandleDispatcherEvaluateExpressionHandleCall.getExpression().getText().includes("this._object.evaluateExpression")) {
      // Add the new argument to the function call
      jsHandleDispatcherEvaluateExpressionHandleCall.addArgument("params.isolatedContext");
}

// ----------------------------
// server/dispatchers/pageDispatcher.ts
// ----------------------------
const pageDispatcherSourceFile = project.addSourceFileAtPath(
  "packages/playwright-core/src/server/dispatchers/pageDispatcher.ts",
);
// ------- workerDispatcher Class -------
const workerDispatcherClass = pageDispatcherSourceFile.getClass("WorkerDispatcher");
// -- evaluateExpression Method --
const workerDispatcherEvaluateExpressionMethod = workerDispatcherClass.getMethod("evaluateExpression");
const workerDispatcherEvaluateExpressionReturn = workerDispatcherEvaluateExpressionMethod.getFirstDescendantByKind(SyntaxKind.ReturnStatement);
const workerDispatcherEvaluateExpressionCall = workerDispatcherEvaluateExpressionReturn.getFirstDescendantByKind(SyntaxKind.CallExpression).getFirstDescendantByKind(SyntaxKind.CallExpression);
// add isolatedContext Bool Param
if (workerDispatcherEvaluateExpressionCall && workerDispatcherEvaluateExpressionCall.getExpression().getText().includes("this._object.evaluateExpression")) {
      // Add the new argument to the function call
      workerDispatcherEvaluateExpressionCall.addArgument("params.isolatedContext");
}
// -- evaluateExpressionHandle Method --
const workerDispatcherEvaluateExpressionHandleMethod = workerDispatcherClass.getMethod("evaluateExpressionHandle");
const workerDispatcherEvaluateExpressionHandleReturn = workerDispatcherEvaluateExpressionHandleMethod.getFirstDescendantByKind(SyntaxKind.ReturnStatement);
const workerDispatcherEvaluateExpressionHandleCall = workerDispatcherEvaluateExpressionHandleReturn.getFirstDescendantByKind(SyntaxKind.CallExpression).getFirstDescendantByKind(SyntaxKind.CallExpression);
// add isolatedContext Bool Param
if (workerDispatcherEvaluateExpressionHandleCall && workerDispatcherEvaluateExpressionHandleCall.getExpression().getText().includes("this._object.evaluateExpression")) {
      // Add the new argument to the function call
      workerDispatcherEvaluateExpressionHandleCall.addArgument("params.isolatedContext");
}

// ----------------------------
// protocol/validator.ts
// ----------------------------
const validatorSourceFile = project.addSourceFileAtPath(
  "packages/playwright-core/src/protocol/validator.ts",
);
const assignments = validatorSourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression);
const frameEvaluateParamsAssignment = assignments.find(assignment => {
  const left = assignment.getLeft();
    const right = assignment.getRight();
  if (left.getText() !== "scheme.FrameEvaluateExpressionParams") {
    return false;
  }
  return right.isKind(SyntaxKind.CallExpression) && right.getExpression().getText() === "tObject";
});
if (frameEvaluateParamsAssignment) {
  const callExpression = frameEvaluateParamsAssignment.getRight().asKind(SyntaxKind.CallExpression);
  if (callExpression) {
    const objectArg = callExpression.getArguments()[0];
    if (objectArg && objectArg.isKind(SyntaxKind.ObjectLiteralExpression)) {
      objectArg.addPropertyAssignment({
        name: "isolatedContext",
        initializer: "tBoolean"
      });
    }
  }
}
const jsHandleEvaluateExpressionParamsAssignment = assignments.find(assignment => {
  const left = assignment.getLeft();
    const right = assignment.getRight();
  if (left.getText() !== "scheme.JSHandleEvaluateExpressionParams") {
    return false;
  }
  return right.isKind(SyntaxKind.CallExpression) && right.getExpression().getText() === "tObject";
});
if (jsHandleEvaluateExpressionParamsAssignment) {
  const callExpression = jsHandleEvaluateExpressionParamsAssignment.getRight().asKind(SyntaxKind.CallExpression);
  if (callExpression) {
    const objectArg = callExpression.getArguments()[0];
    if (objectArg && objectArg.isKind(SyntaxKind.ObjectLiteralExpression)) {
      objectArg.addPropertyAssignment({
        name: "isolatedContext",
        initializer: "tBoolean"
      });
    }
  }
}
const workerEvaluateExpressionParamsAssignment = assignments.find(assignment => {
  const left = assignment.getLeft();
    const right = assignment.getRight();
  if (left.getText() !== "scheme.WorkerEvaluateExpressionParams") {
    return false;
  }
  return right.isKind(SyntaxKind.CallExpression) && right.getExpression().getText() === "tObject";
});
if (workerEvaluateExpressionParamsAssignment) {
  const callExpression = workerEvaluateExpressionParamsAssignment.getRight().asKind(SyntaxKind.CallExpression);
  if (callExpression) {
    const objectArg = callExpression.getArguments()[0];
    if (objectArg && objectArg.isKind(SyntaxKind.ObjectLiteralExpression)) {
      objectArg.addPropertyAssignment({
        name: "isolatedContext",
        initializer: "tBoolean"
      });
    }
  }
}

// ----------------------------
// protocol/channels.d.ts
// ----------------------------
const channelsTypeFile = project.addSourceFileAtPath(
  "packages/protocol/src/channels.d.ts",
);
const jsHandleEvaluateTypeAlias = channelsTypeFile.getTypeAlias("JSHandleEvaluateExpressionParams");
if (jsHandleEvaluateTypeAlias) {
    const typeLiteral = jsHandleEvaluateTypeAlias.getFirstChildByKind(SyntaxKind.TypeLiteral);
    if (typeLiteral) {
        typeLiteral.addProperty({
            name: "isolatedContext",
            type: "boolean",
            hasQuestionToken: true,
        });
    }
}
const jsHandleEvaluateHandleTypeAlias = channelsTypeFile.getTypeAlias("JSHandleEvaluateHandleExpressionParams");
if (jsHandleEvaluateHandleTypeAlias) {
    const typeLiteral = jsHandleEvaluateHandleTypeAlias.getFirstChildByKind(SyntaxKind.TypeLiteral);
    if (typeLiteral) {
        typeLiteral.addProperty({
            name: "isolatedContext",
            type: "boolean",
            hasQuestionToken: true,
        });
    }
}
const frameEvaluateTypeAlias = channelsTypeFile.getTypeAlias("FrameEvaluateExpressionParams");
if (frameEvaluateTypeAlias) {
    const typeLiteral = frameEvaluateTypeAlias.getFirstChildByKind(SyntaxKind.TypeLiteral);
    if (typeLiteral) {
        typeLiteral.addProperty({
            name: "isolatedContext",
            type: "boolean",
            hasQuestionToken: true,
        });
    }
}
const frameEvaluateHandleTypeAlias = channelsTypeFile.getTypeAlias("FrameEvaluateExpressionHandleParams");
if (frameEvaluateHandleTypeAlias) {
    const typeLiteral = frameEvaluateHandleTypeAlias.getFirstChildByKind(SyntaxKind.TypeLiteral);
    if (typeLiteral) {
        typeLiteral.addProperty({
            name: "isolatedContext",
            type: "boolean",
            hasQuestionToken: true,
        });
    }
}
const workerEvaluateTypeAlias = channelsTypeFile.getTypeAlias("WorkerEvaluateExpressionParams");
if (workerEvaluateTypeAlias) {
    const typeLiteral = workerEvaluateTypeAlias.getFirstChildByKind(SyntaxKind.TypeLiteral);
    if (typeLiteral) {
        typeLiteral.addProperty({
            name: "isolatedContext",
            type: "boolean",
            hasQuestionToken: true,
        });
    }
}
const workerEvaluateHandleTypeAlias = channelsTypeFile.getTypeAlias("WorkerEvaluateExpressionHandleParams");
if (workerEvaluateHandleTypeAlias) {
    const typeLiteral = workerEvaluateHandleTypeAlias.getFirstChildByKind(SyntaxKind.TypeLiteral);
    if (typeLiteral) {
        typeLiteral.addProperty({
            name: "isolatedContext",
            type: "boolean",
            hasQuestionToken: true,
        });
    }
}

// Save the changes without reformatting
project.saveSync();
