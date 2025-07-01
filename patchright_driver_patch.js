import fs from "node:fs/promises";
import { Project, SyntaxKind, IndentationText, ObjectLiteralExpression } from "ts-morph";
import YAML from "yaml";

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
  "removeExposedBindings",
);
removeExposedBindingsMethod.setBodyText(`for (const key of this._pageBindings.keys()) {
  if (!key.startsWith('__pw'))
    this._pageBindings.delete(key);
}
await this.doRemoveExposedBindings();`);

// -- _removeInitScripts Method --
const removeInitScriptsMethod =
  browserContextClass.getMethod("removeInitScripts");
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
  .getInitializerIfKindOrThrow(SyntaxKind.ArrowFunction)
  .getBody()
  .getDescendantsOfKind(SyntaxKind.ArrayLiteralExpression)[0];

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
// crBrowserContextClass.getMethod("doRemoveNonInternalInitScripts").remove();
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
// crBrowserContextClass.addMethod({
  // name: "doRemoveInitScripts",
  // isAsync: true,
// });
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
  "// patchright - custom imports",
  "import crypto from 'crypto';",
  "",
]);

// ------- CRNetworkManager Class -------
const crNetworkManagerClass =
  crNetworkManagerSourceFile.getClass("CRNetworkManager");
crNetworkManagerClass.addProperties([
  {
    name: "_alreadyTrackedNetworkIds",
    type: "Set<string>",
    initializer: "new Set()",
  },
]);

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
      "new RouteImpl(requestPausedSessionInfo!.session, requestPausedEvent.requestId, this._page, requestPausedEvent.networkId, this)",
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

// -- _handleRequestRedirect Method --
//const handleRequestRedirectMethod = crNetworkManagerClass.getMethod("_handleRequestRedirect");
//handleRequestRedirectMethod.setBodyText('return;')

// -- _onRequest Method --
const crOnRequestMethod = crNetworkManagerClass.getMethod("_onRequest");
const crOnRequestMethodBody = crOnRequestMethod.getBody();
crOnRequestMethodBody.insertStatements(0, 'if (this._alreadyTrackedNetworkIds.has(requestWillBeSentEvent.initiator.requestId)) return;')

// -- _onRequestPaused Method --
const onRequestPausedMethod = crNetworkManagerClass.getMethod("_onRequestPaused");
const onRequestPausedMethodBody = onRequestPausedMethod.getBody();
onRequestPausedMethodBody.insertStatements(0, 'if (this._alreadyTrackedNetworkIds.has(event.networkId)) return;')

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
    type: "Page"
  });
  constructorDeclaration.insertParameter(parameters.length+1, {
    name: "networkId",
  });
  constructorDeclaration.insertParameter(parameters.length+2, {
    name: "sessionManager",
  });
  // Modify the constructor's body to include `this._page = page;`
  const body = constructorDeclaration.getBody();
  body.insertStatements(0, "this._page = void 0;");
  body.insertStatements(0, "this._networkId = void 0;");
  body.insertStatements(0, "this._sessionManager = void 0;");
  body.addStatements("this._page = page;");
  body.addStatements("this._networkId = networkId;");
  body.addStatements("this._sessionManager = sessionManager;");
  body.addStatements("eventsHelper.addEventListener(this._session, 'Fetch.requestPaused', async e => await this._networkRequestIntercepted(e));");
}
// Inject HTML code
const fulfillMethod = routeImplClass.getMethodOrThrow("fulfill");
// Insert the custom code at the beginning of the `fulfill` method
const customHTMLInjectCode = `const isTextHtml = response.resourceType === 'Document' || response.headers.some(header => header.name === 'content-type' && header.value.includes('text/html'));
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
    let scriptId = crypto.randomBytes(22).toString('hex');
    let scriptSource = script.source || script;
    injectionHTML += \`<script class="\${this._page._delegate.initScriptTag}" nonce="\${scriptNonce}" type="text/javascript">document.getElementById("\${scriptId}")?.remove();\${scriptSource}</script>\`;
  });
  if (response.isBase64) {
    response.isBase64 = false;
    response.body = injectionHTML + Buffer.from(response.body, 'base64').toString('utf-8');
  } else {
    response.body = injectionHTML + response.body;
  }
}
this._fulfilled = true;
const body = response.isBase64 ? response.body : Buffer.from(response.body).toString('base64');
const responseHeaders = splitSetCookieHeader(response.headers);
await catchDisallowedErrors(async () => {
  await this._session.send('Fetch.fulfillRequest', {
    requestId: response.interceptionId ? response.interceptionId : this._interceptionId,
    responseCode: response.status,
    responsePhrase: network.statusText(response.status),
    responseHeaders,
    body,
  });
});`;
fulfillMethod.setBodyText(customHTMLInjectCode);

// -- continue --
const continueMethod = routeImplClass.getMethodOrThrow("continue");
continueMethod.setBodyText(`this._alreadyContinuedParams = {
  requestId: this._interceptionId,
  url: overrides.url,
  headers: overrides.headers,
  method: overrides.method,
  postData: overrides.postData ? overrides.postData.toString('base64') : undefined,
};
if (overrides.url && (overrides.url === 'http://patchright-init-script-inject.internal/' || overrides.url === 'https://patchright-init-script-inject.internal/')) {
  await catchDisallowedErrors(async () => {
    this._sessionManager._alreadyTrackedNetworkIds.add(this._networkId);
    this._session._sendMayFail('Fetch.continueRequest', { requestId: this._interceptionId, interceptResponse: true });
  }) ;
} else {
  await catchDisallowedErrors(async () => {
    await this._session._sendMayFail('Fetch.continueRequest', this._alreadyContinuedParams);
  });
}`);

// -- _networkRequestIntercepted Method --
routeImplClass.addMethod({
  name: "_networkRequestIntercepted",
  isAsync: true,
  parameters: [
    {
      name: "event",
    },
  ]
});
const networkRequestInterceptedMethod = routeImplClass.getMethod(
  "_networkRequestIntercepted",
);
networkRequestInterceptedMethod.setBodyText(`if (event.resourceType !== 'Document') {
  /*await catchDisallowedErrors(async () => {
    await this._session.send('Fetch.continueRequest', { requestId: event.requestId });
  });*/
  return;
}
if (this._networkId != event.networkId || !this._sessionManager._alreadyTrackedNetworkIds.has(event.networkId)) return;
try {
  if (event.responseStatusCode >= 301 && event.responseStatusCode <= 308  || (event.redirectedRequestId && !event.responseStatusCode)) {
    await this._session.send('Fetch.continueRequest', { requestId: event.requestId, interceptResponse: true });
  } else {
    const responseBody = await this._session.send('Fetch.getResponseBody', { requestId: event.requestId });
    await this.fulfill({
      headers: event.responseHeaders,
      isBase64: true,
      body: responseBody.body,
      status: event.responseStatusCode,
      interceptionId: event.requestId,
      resourceType: event.resourceType,
    })
  }
} catch (error) {
  await this._session._sendMayFail('Fetch.continueRequest', { requestId: event.requestId });
}`);

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
  "// patchright - custom imports",
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

// -- evalOnSelector Method --
const evalOnSelectorMethod = frameClass.getMethod("evalOnSelector");
evalOnSelectorMethod.setBodyText(`const handle = await this.selectors.query(selector, { strict }, scope);
    if (!handle)
      throw new Error('Failed to find element matching selector ' + selector);
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
evalOnSelectorAllMethod.setBodyText(`try {
    const arrayHandle = await this.selectors.queryArrayInMainWorld(selector, scope, isolatedContext);
  const result = await arrayHandle.evaluateExpression(expression, { isFunction }, arg, isolatedContext);
  arrayHandle.dispose();
  return result;
} catch (e) {
  // Do i look like i know whats going on here?
  if ("JSHandles can be evaluated only in the context they were created!" === e.message) return await this.evalOnSelectorAll(selector, expression, isFunction, arg, scope, isolatedContext);
  throw e;
}`);

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

    if (this.isDetached()) throw new Error('Frame was detached');
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

// -- _retryWithProgressIfNotConnected Method --
const retryWithProgressIfNotConnectedMethod = frameClass.getMethod("_retryWithProgressIfNotConnected");
retryWithProgressIfNotConnectedMethod.addParameter({
    name: "returnAction",
    type: "boolean | undefined",
});
retryWithProgressIfNotConnectedMethod.setBodyText(`progress.log("waiting for " + this._asLocator(selector));
return this.retryWithProgressAndTimeouts(progress, [0, 20, 50, 100, 100, 500], async continuePolling => {
  if (performActionPreChecks) await this._page.performActionPreChecks(progress);
  const resolved = await this.selectors.resolveInjectedForSelector(selector, {
    strict
  });
  progress.throwIfAborted();
  if (!resolved) {
    if (returnAction === 'returnOnNotResolved' || returnAction === 'returnAll') {
    const result = await action(null);
    return result === "internal:continuepolling" ? continuePolling2 : result;
  }
    return continuePolling;
  }

  try {
    var client = this._page._delegate._sessionForFrame(resolved.frame)._client;
  } catch (e) {
    var client = this._page._delegate._mainFrameSession._client;
  }
  var utilityContext = await resolved.frame._utilityContext();
  var mainContext = await resolved.frame._mainContext();

  const documentNode = await client.send('Runtime.evaluate', {
    expression: "document",
    serializationOptions: {
      serialization: "idOnly"
    },
    contextId: utilityContext.delegate._contextId,
  });
  const documentScope = new dom.ElementHandle(utilityContext, documentNode.result.objectId);

  let currentScopingElements;
  try {
    currentScopingElements = await this._customFindElementsByParsed(resolved, client, mainContext, documentScope, progress, resolved.info.parsed);
  } catch (e) {
    if ("JSHandles can be evaluated only in the context they were created!" === e.message) return continuePolling3;
    await resolved.injected.evaluateHandle((injected, { error }) => { throw error }, { error: e });
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
      await resolved.injected.evaluateHandle((injected, {
        info,
        elements
      }) => {
        throw injected.strictModeViolationError(info.parsed, elements);
      }, {
        info: resolved.info,
        elements: currentScopingElements
      });
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
  } finally { }
});`);

// -- waitForSelectorInternal Method --
const waitForSelectorInternalMethod = frameClass.getMethod("waitForSelectorInternal");
waitForSelectorInternalMethod.setBodyText(`const {
  state = 'visible'
} = options;
const promise = this._retryWithProgressIfNotConnected(progress, selector, options.strict, true, async handle => {
  const attached = !!handle;
  var visible = false;
  if (attached) {
    if (handle.parentNode.constructor.name == "ElementHandle") {
      visible = await handle.parentNode.evaluateInUtility(([injected, node, { handle }]) => {
        return handle ? injected.utils.isElementVisible(handle) : false;
      }, {
        handle
      });
    } else {
      visible = await handle.parentNode.evaluate((injected, { handle }) => {
        return handle ? injected.utils.isElementVisible(handle) : false;
      }, {
        handle
      });
    }
  }

  const success = {
    attached,
    detached: !attached,
    visible,
    hidden: !visible
  }[state];
  if (!success) {
    return "internal:continuepolling";
  }
  if (options.omitReturnValue) {
    return null;
  }
  const element = state === 'attached' || state === 'visible' ? handle : null;
  if (!element) return null;
  if (options.__testHookBeforeAdoptNode) await options.__testHookBeforeAdoptNode();
  try {
    return element;
  } catch (e) {
    return "internal:continuepolling";
  }
}, "returnOnNotResolved");
return scope ? scope._context._raceAgainstContextDestroyed(promise) : promise;`)

// -- isVisibleInternal Method --
const isVisibleInternalMethod = frameClass.getMethod("isVisibleInternal");
isVisibleInternalMethod.setBodyText(`try {
  const customMetadata = { "internal": false, "log": [], "method": "isVisible" };
  const controller = new ProgressController(customMetadata, this);
  return await controller.run(async progress => {
    progress.log("waiting for " + this._asLocator(selector));
    const promise = this._retryWithProgressIfNotConnected(progress, selector, options.strict, false, async handle => {
      if (!handle) return false;
      if (handle.parentNode.constructor.name == "ElementHandle") {
        return await handle.parentNode.evaluateInUtility(([injected, node, { handle }]) => {
          const state = handle ? injected.elementState(handle, 'visible') : {
            matches: false,
            received: 'error:notconnected'
          };
          return state.matches;
        }, { handle });
      } else {
        return await handle.parentNode.evaluate((injected, { handle }) => {
          const state = handle ? injected.elementState(handle, 'visible') : {
            matches: false,
            received: 'error:notconnected'
          };
          return state.matches;
        }, { handle });
      }
    }, "returnOnNotResolved");

    return scope ? scope._context._raceAgainstContextDestroyed(promise) : promise;
  }, 10000) || false; // A bit geeky but its okay :D
} catch (e) {
  if (js.isJavaScriptErrorInEvaluate(e) || isInvalidSelectorError(e) || isSessionClosedError(e)) throw e;
  return false;
}`)

// -- queryCount Method --
const queryCountMethod = frameClass.getMethod("queryCount");
queryCountMethod.setBodyText(`const customMetadata = {
  "internal": false,
  "log": [],
  "method": "queryCount"
};
const controller = new ProgressController(customMetadata, this);
const resultPromise = await controller.run(async progress => {
  progress.log("waiting for " + this._asLocator(selector));
  const promise = await this._retryWithProgressIfNotConnected(progress, selector, null, false, async result => {
    if (!result) return 0;
    const handle = result[0];
    const handles = result[1];
    return handle ? handles.length : 0;
  }, 'returnAll');
  return promise;
}, 10000); // A bit geeky but its okay :D
return resultPromise ? resultPromise : 0;
`);

// -- _expectInternal Method --
const expectInternalMethod = frameClass.getMethod("_expectInternal");
expectInternalMethod.setBodyText(`progress.log("waiting for " + this._asLocator(selector));
const isArray = options.expression === 'to.have.count' || options.expression.endsWith('.array');

const promise = await this._retryWithProgressIfNotConnected(progress, selector, !isArray, false, async result => {
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
}, 'returnAll');

// Default Values, if no Elements found
var matches = false;
var received = 0;
var missingReceived = null;
if (promise) {
  matches = promise.matches;
  received = promise.received;
  missingReceived = promise.missingReceived;
} else if (options.expectedNumber === 0) {
  matches = true;
}

// Note: missingReceived avoids unexpected value "undefined" when element was not found.
if (matches === options.isNot) {
  lastIntermediateResult.received = missingReceived ? '<element(s) not found>' : received;
  lastIntermediateResult.isSet = true;
  if (!missingReceived && !Array.isArray(received)) progress.log('  unexpected value "' + renderUnexpectedValue(options.expression, received) + '"');
}
return {
  matches,
  received
};`)

// -- _callOnElementOnceMatches Method --
const callOnElementOnceMatchesMethod = frameClass.getMethod("_callOnElementOnceMatches");
callOnElementOnceMatchesMethod.setBodyText(`const callbackText = body.toString();
const controller = new ProgressController(metadata, this);
return controller.run(async progress => {
  progress.log("waiting for "+ this._asLocator(selector));
  const promise = this._retryWithProgressIfNotConnected(progress, selector, options.strict, false, async handle => {
    if (handle.parentNode.constructor.name == "ElementHandle") {
      return await handle.parentNode.evaluateInUtility(([injected, node, { callbackText, handle, taskData }]) => {
        const callback = injected.eval(callbackText);
        return callback(injected, handle, taskData);
      }, {
        callbackText,
        handle,
        taskData
      });
    } else {
      return await handle.parentNode.evaluate((injected, { callbackText, handle, taskData }) => {
        const callback = injected.eval(callbackText);
        return callback(injected, handle, taskData);
      }, {
        callbackText,
        handle,
        taskData
      });
    }
  });
  return scope ? scope._context._raceAgainstContextDestroyed(promise) : promise;
}, this._page._timeoutSettings.timeout(options));`)

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
customFindElementsByParsedMethod.setBodyText(`var parsedEdits = { ...parsed };
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
    if (partNth > currentScopingElements.length-1 || partNth < -(currentScopingElements.length-1)) {
          throw new Error("Can't query n-th element");
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
          elements.push(elementToCheck);
        }
      }
    }
  }
  // Setting currentScopingElements to the elements we just queried
  currentScopingElements = [];
  for (var element of elements) {
    var elemIndex = element.backendNodeId;
    // prevent duplicate elements
    if (elementsIndexes.includes(elemIndex)) continue
    // Sorting the Elements by their occourance in the DOM
    var elemPos = elementsIndexes.findIndex(index => index > elemIndex);

    // Sort the elements by their backendNodeId
    if (elemPos === -1) {
      currentScopingElements.push(element);
      elementsIndexes.push(elemIndex);
    } else {
      currentScopingElements.splice(elemPos, 0, element);
      elementsIndexes.splice(elemPos, 0, elemIndex);
    }
  }
}
return currentScopingElements;`);

// ----------------------------
// server/frameSelectors.ts
// ----------------------------
const frameSelectorsSourceFile = project.addSourceFileAtPath(
  "packages/playwright-core/src/server/frameSelectors.ts",
);
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
resolveFrameForSelectorIfStatement.replaceWithText(`if (!element) {
  try {
    var client = frame._page._delegate._sessionForFrame(frame)._client;
  } catch (e) {
    var client = frame._page._delegate._mainFrameSession._client;
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
}`);


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
customFindFramesByParsedSelectorsMethod.setBodyText(`var parsedEdits = { ...parsed };
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
          elements.push(elementToCheck);
        }
      }
    }
  }
  currentScopingElements = [];
  for (var element of elements) {
    var elemIndex = element.backendNodeId;
    var elemPos = elementsIndexes.findIndex((index) => index > elemIndex);
    if (elemPos === -1) {
      currentScopingElements.push(element);
      elementsIndexes.push(elemIndex);
    } else {
      currentScopingElements.splice(elemPos, 0, element);
      elementsIndexes.splice(elemPos, 0, elemIndex);
    }
  }
}
return currentScopingElements;`);


// ----------------------------
// server/chromium/crPage.ts
// ----------------------------
const crPageSourceFile = project.addSourceFileAtPath(
  "packages/playwright-core/src/server/chromium/crPage.ts",
);
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
// crPageClass
//   .getMethod("removeNonInternalInitScripts")
//   .rename("removeInitScripts");

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
  "removeExposedBindings",
);
pageRemoveExposedBindingsMethod.setBodyText(`for (const key of this._pageBindings.keys()) {
  if (!key.startsWith('__pw'))
    this._pageBindings.delete(key);
}
await this._delegate.removeExposedBindings();`);

// -- _removeInitScripts Method --
const pageRemoveInitScriptsMethod = pageClass.getMethod("removeInitScripts");
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
this.source = createPageBindingScript(name, needsHandle);
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
  if (context.constructor.name === "FrameExecutionContext") {
      const frame = this._context.frame;
      if (frame) {
          if (isolatedContext) context = await frame._utilityContext();
          else if (!isolatedContext) context = await frame._mainContext();
      }
  }`,
);

// ----------------------------
// server/pageBinding.ts
// ----------------------------
// todo: pageBinding.ts was removed, there may be regressions in the patch here
// const pageBindingSourceFile = project.addSourceFileAtPath(
//   "packages/playwright-core/src/server/pageBinding.ts",
// );

// // ------- addPageBinding Function -------
// const addPageBindingFunction = pageBindingSourceFile.getFunction("addPageBinding");
// const parameters = addPageBindingFunction.getParameters();
// parameters.forEach((param) => {
//   if (param.getName() === "playwrightBinding") {
//     param.remove();
//   }
// });
// addPageBindingFunction.getStatements().forEach((statement) => {
//   if (statement.getText().includes("(globalThis as any)[playwrightBinding]")) {
//     // Replace the line with the new code.
//     statement.replaceWithText(
//       `const binding = (globalThis as any)[bindingName];
// if (!binding || binding.toString().startsWith("(...args) => {")) return`,
//     );
//   }
// });

// const statements = addPageBindingFunction.getBodyOrThrow().getStatements();
// for (const statement of statements) {
//   if (statement.getKind() === SyntaxKind.IfStatement) {
//     const ifStatement = statement.asKindOrThrow(SyntaxKind.IfStatement);
//     // Check if the if-statement is the one we're looking for
//     const expressionText = ifStatement.getExpression().getText();
//     if (expressionText === "binding.__installed") {
//       ifStatement.remove();
//     }
//   }
//   // Remove the assignment: (globalThis as any)[bindingName].__installed = true;
//   if (statement.getKind() === SyntaxKind.ExpressionStatement) {
//     const expressionStatement = statement.asKindOrThrow(
//       SyntaxKind.ExpressionStatement,
//     );
//     const expressionText = expressionStatement.getExpression().getText();
//     if (
//       expressionText === "(globalThis as any)[bindingName].__installed = true"
//     ) {
//       expressionStatement.remove();
//     }
//   }
// }

// ------- createPageBindingScript Function -------
const createPageBindingScriptFunction = pageBindingSourceFile.getFunction("createPageBindingScript");
createPageBindingScriptFunction.getParameter("playwrightBinding")?.remove();
createPageBindingScriptFunction.setBodyText('return `(${addPageBinding.toString()})(${JSON.stringify(name)}, ${needsHandle}, (${source}), (${builtins})())`;')

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
  if (context.constructor.name === "FrameExecutionContext") {
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
// -- evaluateExpression Method --
const frameEvalOnSelectorAllExpressionMethod = frameDispatcherClass.getMethod("evalOnSelectorAll");
frameEvalOnSelectorAllExpressionMethod.setBodyText(`return { value: serializeResult(await this._frame.evalOnSelectorAll(params.selector, params.expression, params.isFunction, parseArgument(params.arg), null, params.isolatedContext)) };`);

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
// injected/src/xpathSelectorEngine.ts
// ----------------------------
const isomorphicBuiltinsSourceFile = project.addSourceFileAtPath(
  "packages/playwright-core/src/utils/isomorphic/builtins.ts"
);
// -- evaluateExpression Method --
const isomorphicBuiltinsMethod = isomorphicBuiltinsSourceFile.getFunction("builtins");
isomorphicBuiltinsMethod.setBodyText(`global = global ?? globalThis;
  return {
    setTimeout: global.setTimeout?.bind(global),
    clearTimeout: global.clearTimeout?.bind(global),
    setInterval: global.setInterval?.bind(global),
    clearInterval: global.clearInterval?.bind(global),
    requestAnimationFrame: global.requestAnimationFrame?.bind(global),
    cancelAnimationFrame: global.cancelAnimationFrame?.bind(global),
    requestIdleCallback: global.requestIdleCallback?.bind(global),
    cancelIdleCallback: global.cancelIdleCallback?.bind(global),
    performance: global.performance,
    eval: global.eval?.bind(global),
    Intl: global.Intl,
    Date: global.Date,
    Map: global.Map,
    Set: global.Set
  };`);

// ----------------------------
// injected/src/xpathSelectorEngine.ts
// ----------------------------
const xpathSelectorEngineSourceFile = project.addSourceFileAtPath(
  "packages/injected/src/xpathSelectorEngine.ts",
);
// ------- XPathEngine Class -------
const xPathEngineLiteral = xpathSelectorEngineSourceFile.getVariableDeclarationOrThrow("XPathEngine").getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
// -- evaluateExpression Method --
const queryAllMethod = xPathEngineLiteral.getProperty("queryAll");
const queryAllMethodBody = queryAllMethod.getBody();
queryAllMethodBody.insertStatements(0, [
  "if (root.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {",
  "  const result: Element[] = [];",
  "  // Custom ClosedShadowRoot XPath Engine",
  "  const parser = new DOMParser();",
  "  // Function to (recursively) get all elements in the shadowRoot",
  "  function getAllChildElements(node) {",
  "    const elements = [];",
  "    const traverse = (currentNode) => {",
  "      if (currentNode.nodeType === Node.ELEMENT_NODE) elements.push(currentNode);",
  "      currentNode.childNodes?.forEach(traverse);",
  "    };",
  "    if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE || node.nodeType === Node.ELEMENT_NODE) {",
  "      traverse(node);",
  "    }",
  "    return elements;",
  "  }",
  "  // Setting innerHTMl and childElements (all, recursive) to avoid race conditions",
  "  const csrHTMLContent = root.innerHTML;",
  "  const csrChildElements = getAllChildElements(root);",
  "  const htmlDoc = parser.parseFromString(csrHTMLContent, 'text/html');",
  "  const rootDiv = htmlDoc.body",
  "  const rootDivChildElements = getAllChildElements(rootDiv);",
  "  // Use the namespace prefix in the XPath expression",
  "  const it = htmlDoc.evaluate(selector, htmlDoc, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE);",
  "  for (let node = it.iterateNext(); node; node = it.iterateNext()) {",
  "    // -1 for the body element",
  "    const nodeIndex = rootDivChildElements.indexOf(node) - 1;",
  "    if (nodeIndex >= 0) {",
  "      const originalNode = csrChildElements[nodeIndex];",
  "      if (originalNode.nodeType === Node.ELEMENT_NODE)",
  "        result.push(originalNode as Element);",
  "    }",
  "  }",
  "  return result;",
  "}",
  ""
]);

// Save the changes without reformatting
project.saveSync();

// ----------------------------
// protocol/protocol.yml
// ----------------------------
const protocol = YAML.parse(await fs.readFile("packages/protocol/src/protocol.yml", "utf8"));
for (const type of ["Frame", "JSHandle", "Worker"]) {
    const commands = protocol[type].commands;
    commands.evaluateExpression.parameters.isolatedContext = "boolean?";
    commands.evaluateExpressionHandle.parameters.isolatedContext = "boolean?";
}
protocol["Frame"].commands.evalOnSelectorAll.parameters.isolatedContext = "boolean?";
await fs.writeFile("packages/protocol/src/protocol.yml", YAML.stringify(protocol));
