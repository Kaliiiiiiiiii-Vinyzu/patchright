import fs from "node:fs/promises";
import path from 'path';
import { Project, SyntaxKind, IndentationText, ObjectLiteralExpression } from "ts-morph";
import YAML from "yaml";

import * as patches from "./driver_patches/index.js";

const project = new Project({
  manipulationSettings: {
    indentationText: IndentationText.TwoSpaces,
  },
});



// ----------------------------
// client/clientHelper.ts
// ----------------------------
const clientHelperSourceFile = project.addSourceFileAtPath(
  "packages/playwright-core/src/client/clientHelper.ts",
);
// ------- addSourceUrlToScript Function -------
const addSourceUrlToScriptFunction = clientHelperSourceFile.getFunction("addSourceUrlToScript");
addSourceUrlToScriptFunction.setBodyText(`return source`);

// ----------------------------
// client/browserContext.ts
// ----------------------------
const clientBrowserContextSourceFile = project.addSourceFileAtPath(
  "packages/playwright-core/src/client/browserContext.ts",
);
// ------- BrowserContext Class -------
const clientBrowserContextClass = clientBrowserContextSourceFile.getClass("BrowserContext");
clientBrowserContextClass.addProperty({ name: "routeInjecting", type: "boolean", initializer: "false" });

// -- addInitScript Method --
const clientAddInitScriptMethod = clientBrowserContextClass.getMethod("addInitScript");
const clientAddInitScriptMethodBody = clientAddInitScriptMethod.getBody();
clientAddInitScriptMethodBody.insertStatements(0, "await this.installInjectRoute();");

// -- exposeBinding Method --
const clientExposeBindingMethod = clientBrowserContextClass.getMethod("exposeBinding");
const clientExposeBindingMethodBody = clientExposeBindingMethod.getBody();
clientExposeBindingMethodBody.insertStatements(0, "await this.installInjectRoute();");

// -- exposeFunction Method --
const clientExposeFunctionMethod = clientBrowserContextClass.getMethod("exposeFunction");
const clientExposeFunctionMethodBody = clientExposeFunctionMethod.getBody();
clientExposeFunctionMethodBody.insertStatements(0, "await this.installInjectRoute();");

// -- installInjectRoute Method --
clientBrowserContextClass.addMethod({
  name: "installInjectRoute",
  isAsync: true,
});
const clientBrowserContextInstallInjectRouteMethod = clientBrowserContextClass.getMethod("installInjectRoute");
clientBrowserContextInstallInjectRouteMethod.setBodyText(`
  if (this.routeInjecting) return;
    await this.route('**/*', async route => {
    try {
        if (route.request().resourceType() === 'document' && route.request().url().startsWith('http')) {
            const protocol = route.request().url().split(':')[0];
            await route.fallback({ url: protocol + '://patchright-init-script-inject.internal/' });
        } else {
            await route.fallback();
        }
    } catch (error) {
        await route.fallback();
    }
  });
`);

// -- constructor: wrap auto-dismiss dialog in internal zone to avoid trace pollution --
// Patchright always dispatches dialog events to the client (server patch). When no listener
// is attached, the client auto-dismisses. Without this patch, the auto-dismiss creates a
// "Dismiss dialog" trace entry. Wrapping in _wrapApiCall({ internal: true }) suppresses it.
{
  let sourceText = clientBrowserContextSourceFile.getFullText();
  sourceText = sourceText.replace(
    "dialog.accept({}).catch(() => {});",
    "dialogObject._wrapApiCall(() => dialog.accept({}).catch(() => {}), { internal: true });"
  );
  sourceText = sourceText.replace(
    "dialog.dismiss().catch(() => {});",
    "dialogObject._wrapApiCall(() => dialog.dismiss().catch(() => {}), { internal: true });"
  );
  clientBrowserContextSourceFile.replaceWithText(sourceText);
}

// ----------------------------
// client/page.ts
// ----------------------------
const clientPageSourceFile = project.addSourceFileAtPath(
  "packages/playwright-core/src/client/page.ts",
);
// ------- Page Class -------
const clientPageClass = clientPageSourceFile.getClass("Page");
clientPageClass.addProperty({ name: "routeInjecting", type: "boolean", initializer: "false" });

// -- addInitScript Method --
const clientPageAddInitScriptMethod = clientPageClass.getMethod("addInitScript");
const clientPageAddInitScriptMethodBody = clientPageAddInitScriptMethod.getBody();
clientPageAddInitScriptMethodBody.insertStatements(0, "await this.installInjectRoute();");

// -- exposeBinding Method --
const clientPageExposeBindingMethod = clientPageClass.getMethod("exposeBinding");
const clientPageExposeBindingMethodBody = clientPageExposeBindingMethod.getBody();
clientPageExposeBindingMethodBody.insertStatements(0, "await this.installInjectRoute();");

// -- exposeFunction Method --
const clientPageExposeFunctionMethod = clientPageClass.getMethod("exposeFunction");
const clientPageExposeFunctionMethodBody = clientPageExposeFunctionMethod.getBody();
clientPageExposeFunctionMethodBody.insertStatements(0, "await this.installInjectRoute();");

// -- installInjectRoute Method --
clientPageClass.addMethod({
  name: "installInjectRoute",
  isAsync: true,
});
const clientPageInstallInjectRouteMethod = clientPageClass.getMethod("installInjectRoute");
clientPageInstallInjectRouteMethod.setBodyText(`
  if (this.routeInjecting || this.context().routeInjecting) return;
  await this.route('**/*', async route => {
    try {
      if (route.request().resourceType() === 'document' && route.request().url().startsWith('http')) {
          const protocol = route.request().url().split(':')[0];
          await route.fallback({ url: protocol + '://patchright-init-script-inject.internal/' });
      } else {
          await route.fallback();
      }
  } catch (error) {
      await route.fallback();
    }
  });
`);

// -- evaluate Method --
const clientPageEvaluateMethod = clientPageClass.getMethod("evaluate");
clientPageEvaluateMethod.addParameter({
  name: "isolatedContext",
  type: "boolean",
  initializer: "true",
});
const clientPageEvaluateAssertCall = clientPageEvaluateMethod.getFirstDescendant(node =>
  node.isKind(SyntaxKind.CallExpression) &&
  node.getText().includes("assertMaxArguments")
);
if (clientPageEvaluateAssertCall) {
  clientPageEvaluateAssertCall.replaceWithText(clientPageEvaluateAssertCall.getText().replace("2", "3"));
}
// Modify the function call inside the return statement to include 'isolatedContext'
const clientPageEvaluateReturnStatement = clientPageEvaluateMethod.getFirstDescendant(node =>
  node.isKind(SyntaxKind.ReturnStatement)
);
if (clientPageEvaluateReturnStatement) {
  clientPageEvaluateReturnStatement.replaceWithText(
    clientPageEvaluateReturnStatement.getText().replace(
          "this._mainFrame.evaluate(pageFunction, arg)",
          "this._mainFrame.evaluate(pageFunction, arg, isolatedContext)"
      )
  );
}

// -- evaluateHandle Method --
const clientPageEvaluateHandleMethod = clientPageClass.getMethod("evaluateHandle");
clientPageEvaluateHandleMethod.addParameter({
  name: "isolatedContext",
  type: "boolean",
  initializer: "true",
});
const clientPageEvaluateHandlAssertCall = clientPageEvaluateHandleMethod.getFirstDescendant(node =>
  node.isKind(SyntaxKind.CallExpression) &&
  node.getText().includes("assertMaxArguments")
);
if (clientPageEvaluateHandlAssertCall) {
  clientPageEvaluateHandlAssertCall.replaceWithText(clientPageEvaluateHandlAssertCall.getText().replace("2", "3"));
}
// Modify the function call inside the return statement to include 'isolatedContext'
const clientPageEvaluateHandleReturnStatement = clientPageEvaluateHandleMethod.getFirstDescendant(node =>
  node.isKind(SyntaxKind.ReturnStatement)
);
if (clientPageEvaluateHandleReturnStatement) {
  clientPageEvaluateHandleReturnStatement.replaceWithText(
    clientPageEvaluateHandleReturnStatement.getText().replace(
      "this._mainFrame.evaluateHandle(pageFunction, arg)",
      "this._mainFrame.evaluateHandle(pageFunction, arg, isolatedContext)"
    )
  );
}

// ----------------------------
// client/clock.ts
// ----------------------------
const clientClockSourceFile = project.addSourceFileAtPath(
  "packages/playwright-core/src/client/clock.ts",
);
// ------- Page Class -------
const clientClockClass = clientClockSourceFile.getClass("Clock");
// -- install Method --
const clientInstallMethod = clientClockClass.getMethod("install");
const clientInstallMethodBody = clientInstallMethod.getBody();
clientInstallMethodBody.insertStatements(0, "await this._browserContext.installInjectRoute()");

// ----------------------------
// client/worker.ts
// ----------------------------
const workerSourceFile = project.addSourceFileAtPath(
  "packages/playwright-core/src/client/worker.ts",
);
// ------- Worker Class -------
const clientWorkerClass = workerSourceFile.getClass("Worker");
// -- evaluate Method --
const workerEvaluateMethod = clientWorkerClass.getMethod("evaluate");
workerEvaluateMethod.addParameter({
  name: "isolatedContext",
  type: "boolean",
  initializer: "true",
});
const workerEvaluateAssertCall = workerEvaluateMethod.getFirstDescendant(node =>
  node.isKind(SyntaxKind.CallExpression) &&
  node.getText().includes("assertMaxArguments")
);
if (workerEvaluateAssertCall) {
  workerEvaluateAssertCall.replaceWithText(workerEvaluateAssertCall.getText().replace("2", "3"));
}
// Modify the function call inside the return statement to include 'isolatedContext'
const workerEvaluateExpressionCall = workerEvaluateMethod.getFirstDescendant(node =>
  node.isKind(SyntaxKind.CallExpression) &&
  node.getText().includes("this._channel.evaluateExpression")
);

if (workerEvaluateExpressionCall) {
  workerEvaluateExpressionCall.replaceWithText(
    workerEvaluateExpressionCall.getText().replace(
      /(\{[\s\S]*?arg:\s*serializeArgument\(arg\))/,
      "$1, isolatedContext: isolatedContext"
    )
  );
}

// -- evaluateHandle Method --
const workerEvaluateHandleMethod = clientWorkerClass.getMethod("evaluateHandle");
workerEvaluateHandleMethod.addParameter({
  name: "isolatedContext",
  type: "boolean",
  initializer: "true",
});
const workerEvaluateHandleAssertCall = workerEvaluateHandleMethod.getFirstDescendant(node =>
  node.isKind(SyntaxKind.CallExpression) &&
  node.getText().includes("assertMaxArguments")
);
if (workerEvaluateHandleAssertCall) {
  workerEvaluateHandleAssertCall.replaceWithText(workerEvaluateHandleAssertCall.getText().replace("2", "3"));
}
// Modify the function call inside the return statement to include 'isolatedContext'
const workerEvaluateHandleExpressionCall = workerEvaluateHandleMethod.getFirstDescendant(node =>
  node.isKind(SyntaxKind.CallExpression) &&
  node.getText().includes("this._channel.evaluateExpression")
);

if (workerEvaluateHandleExpressionCall) {
  workerEvaluateHandleExpressionCall.replaceWithText(
    workerEvaluateHandleExpressionCall.getText().replace(
      /(\{[\s\S]*?arg:\s*serializeArgument\(arg\))/,
      "$1, isolatedContext: isolatedContext"
    )
  );
}

// ----------------------------
// client/frame.ts
// ----------------------------
const frameSourceFile = project.addSourceFileAtPath(
  "packages/playwright-core/src/client/frame.ts",
);
// ------- Frame Class -------
const clientFrameClass = frameSourceFile.getClass("Frame");
// -- evaluate Method --
const frameEvaluateMethod = clientFrameClass.getMethod("evaluate");
frameEvaluateMethod.addParameter({
  name: "isolatedContext",
  type: "boolean",
  initializer: "true",
});
const frameEvaluateAssertCall = frameEvaluateMethod.getFirstDescendant(node =>
  node.isKind(SyntaxKind.CallExpression) &&
  node.getText().includes("assertMaxArguments")
);
if (frameEvaluateAssertCall) {
  frameEvaluateAssertCall.replaceWithText(frameEvaluateAssertCall.getText().replace("2", "3"));
}
// Modify the function call inside the return statement to include 'isolatedContext'
const clientFrameEvaluateExpressionCall = frameEvaluateMethod.getFirstDescendant(node =>
  node.isKind(SyntaxKind.CallExpression) &&
  node.getText().includes("this._channel.evaluateExpression")
);

if (clientFrameEvaluateExpressionCall) {
  clientFrameEvaluateExpressionCall.replaceWithText(
    clientFrameEvaluateExpressionCall.getText().replace(
      /(\{[\s\S]*?arg:\s*serializeArgument\(arg\))/,
      "$1, isolatedContext: isolatedContext"
    )
  );
}

// -- evaluateHandle Method --
const frameEvaluateHandleMethod = clientFrameClass.getMethod("evaluateHandle");
frameEvaluateHandleMethod.addParameter({
  name: "isolatedContext",
  type: "boolean",
  initializer: "true",
});
const frameEvaluateHandleAssertCall = frameEvaluateHandleMethod.getFirstDescendant(node =>
  node.isKind(SyntaxKind.CallExpression) &&
  node.getText().includes("assertMaxArguments")
);
if (frameEvaluateHandleAssertCall) {
  frameEvaluateHandleAssertCall.replaceWithText(frameEvaluateHandleAssertCall.getText().replace("2", "3"));
}
// Modify the function call inside the return statement to include 'isolatedContext'
const frameEvaluateHandleExpressionCall = frameEvaluateHandleMethod.getFirstDescendant(node =>
  node.isKind(SyntaxKind.CallExpression) &&
  node.getText().includes("this._channel.evaluateExpression")
);

if (frameEvaluateHandleExpressionCall) {
  frameEvaluateHandleExpressionCall.replaceWithText(
    frameEvaluateHandleExpressionCall.getText().replace(
      /(\{[\s\S]*?arg:\s*serializeArgument\(arg\))/,
      "$1, isolatedContext: isolatedContext"
    )
  );
}

// -- $$eval Method --
const frameEvalOnSelectorMethod = clientFrameClass.getMethod("$$eval");
frameEvalOnSelectorMethod.addParameter({
  name: "isolatedContext",
  type: "boolean",
  initializer: "true",
});
const frameEvalOnSelectorAssertCall = frameEvalOnSelectorMethod.getFirstDescendant(node =>
  node.isKind(SyntaxKind.CallExpression) &&
  node.getText().includes("assertMaxArguments")
);
if (frameEvalOnSelectorAssertCall) {
  frameEvalOnSelectorAssertCall.replaceWithText(frameEvalOnSelectorAssertCall.getText().replace("3", "4"));
}
// Modify the function call inside the return statement to include 'isolatedContext'
const frameEvalOnSelectorExpressionCall = frameEvalOnSelectorMethod.getFirstDescendant(node =>
  node.isKind(SyntaxKind.CallExpression) &&
  node.getText().includes("this._channel.evalOnSelectorAll")
);

if (frameEvalOnSelectorExpressionCall) {
  frameEvalOnSelectorExpressionCall.replaceWithText(
    frameEvalOnSelectorExpressionCall.getText().replace(
      /(\{[\s\S]*?arg:\s*serializeArgument\(arg\))/,
      "$1, isolatedContext: isolatedContext"
    )
  );
}

// ----------------------------
// client/locator.ts
// ----------------------------
const locatorSourceFile = project.addSourceFileAtPath(
  "packages/playwright-core/src/client/locator.ts",
);
// Add the custom import and comment at the start of the file
locatorSourceFile.insertStatements(0, [
  "// undetected-undetected_playwright-patch - custom imports",
  "import { JSHandle, parseResult, serializeArgument } from './jsHandle';",
  "",
]);
// ------- Locator Class -------
const locatorClass = locatorSourceFile.getClass("Locator");
// -- evaluate Method --
const locatorEvaluateMethod = locatorClass.getMethod("evaluate");
locatorEvaluateMethod.addParameter({
  name: "isolatedContext",
  type: "boolean",
  initializer: "true",
});
locatorEvaluateMethod.setBodyText(`
  if (typeof options === 'boolean') {
    isolatedContext = options;
    options = undefined;
  }
  return await this._withElement(
    async (h) =>
      parseResult(
        (
          await h._channel.evaluateExpression({
            expression: String(pageFunction),
            isFunction: typeof pageFunction === "function",
            arg: serializeArgument(arg),
            isolatedContext: isolatedContext,
          })
        ).value
      ),
    { title: "Evaluate", timeout: options?.timeout }
  );
`)

// -- evaluateHandle Method --
const locatorEvaluateHandleMethod = locatorClass.getMethod("evaluateHandle");
locatorEvaluateHandleMethod.addParameter({
  name: "isolatedContext",
  type: "boolean",
  initializer: "true",
});
locatorEvaluateHandleMethod.setBodyText(`
  if (typeof options === 'boolean') {
    isolatedContext = options;
    options = undefined;
  }
  return await this._withElement(
    async (h) =>
      JSHandle.from(
        (
          await h._channel.evaluateExpressionHandle({
            expression: String(pageFunction),
            isFunction: typeof pageFunction === "function",
            arg: serializeArgument(arg),
            isolatedContext: isolatedContext,
          })
        ).handle
      ) as any as structs.SmartHandle<R>,
    { title: "Evaluate", timeout: options?.timeout }
  );
`)

// -- evaluateAll Method --
const locatorEvaluateAllMethod = locatorClass.getMethod("evaluateAll");
locatorEvaluateAllMethod.addParameter({
  name: "isolatedContext",
  type: "boolean",
  initializer: "true",
});
locatorEvaluateAllMethod.setBodyText(`return await this._frame.$$eval(this._selector, pageFunction, arg, isolatedContext);`)

// ----------------------------
// client/jsHandle.ts
// ----------------------------
const jsHandleSourceFile = project.addSourceFileAtPath(
  "packages/playwright-core/src/client/jsHandle.ts",
);
// ------- JSHandle Class -------
const clientJSHandleClass = jsHandleSourceFile.getClass("JSHandle");
// -- evaluate Method --
const jsHandleEvaluateMethod = clientJSHandleClass.getMethod("evaluate");
jsHandleEvaluateMethod.addParameter({
  name: "isolatedContext",
  type: "boolean",
  initializer: "true",
});
jsHandleEvaluateMethod.setBodyText(`
  const result = await this._channel.evaluateExpression({ expression: String(pageFunction), isFunction: typeof pageFunction === 'function', arg: serializeArgument(arg), isolatedContext: isolatedContext });
  return parseResult(result.value);
`)

// -- evaluateHandle Method --
const jsHandleEvaluateHandleMethod = clientJSHandleClass.getMethod("evaluateHandle");
jsHandleEvaluateHandleMethod.addParameter({
  name: "isolatedContext",
  type: "boolean",
  initializer: "true",
});
jsHandleEvaluateHandleMethod.setBodyText(`
  const result = await this._channel.evaluateExpressionHandle({ expression: String(pageFunction), isFunction: typeof pageFunction === 'function', arg: serializeArgument(arg), isolatedContext: isolatedContext });
  return JSHandle.from(result.handle) as any as structs.SmartHandle<R>;
`)


// ----------------------------
// client/tracing.ts
// ----------------------------
const tracingSourceFile = project.addSourceFileAtPath(
  "packages/playwright-core/src/client/tracing.ts",
);
// ------- Tracing Class -------
const clientTracingClass = tracingSourceFile.getClass("Tracing");
// -- start Method --
const tracingStartMethod = clientTracingClass.getMethod("start");
tracingStartMethod.insertStatements(0, "if (typeof this._parent.installInjectRoute === 'function') await this._parent.installInjectRoute();");

// Here the Driver Patch will be added by fetching the code from the main Driver Repository (in the workflow).
// The URL from which the code is added is: https://raw.githubusercontent.com/Kaliiiiiiiiii-Vinyzu/patchright/refs/heads/main/patchright_driver_patch.js
// Note: The Project is also synced (saved) in this code, so we dont need to add it here.


// ----------------------------
// server/browserContext.ts
// ----------------------------
patches.patchBrowserContext(project);

// ----------------------------
// server/chromium/chromium.ts
// ----------------------------
patches.patchChromium(project);

// ----------------------------
// server/chromium/chromiumSwitches.ts
// ----------------------------
patches.patchChromiumSwitches(project);

// ----------------------------
// server/chromium/crBrowser.ts
// ----------------------------
patches.patchCRBrowser(project);

// ----------------------------
// server/chromium/crDevTools.ts
// ----------------------------
patches.patchCRDevTools(project);

// ----------------------------
// server/chromium/crNetworkManager.ts
// ----------------------------
patches.patchCRNetworkManager(project);

// ----------------------------
// server/chromium/crCoverage.ts
// ----------------------------
patches.patchCRCoverage(project);

// ----------------------------
// server/chromium/crServiceWorker.ts
// ----------------------------
patches.patchCRServiceWorker(project);

// ----------------------------
// server/frames.ts
// ----------------------------
patches.patchFrames(project);

// ----------------------------
// server/frameSelectors.ts
// ----------------------------
patches.patchFrameSelectors(project);

// ----------------------------
// server/chromium/crPage.ts
// ----------------------------
patches.patchCRPage(project);

// ----------------------------
// server/page.ts
// ----------------------------
patches.patchPage(project);

// ----------------------------
// server/utils/expectUtils.ts
// ----------------------------
patches.patchExpectUtils(project);

// ----------------------------
// utils/isomorphic/utilityScriptSerializers.ts
// ----------------------------
patches.patchUtilityScriptSerializers(project);

// ----------------------------
// server/pageBinding.ts
// ----------------------------
patches.patchPageBinding(project);
// ----------------------------
// server/clock.ts
// ----------------------------
patches.patchClock(project);

// ----------------------------
// server/javascript.ts
// ----------------------------
patches.patchJavascript(project);

// ----------------------------
// server/dispatchers/frameDispatcher.ts
// ----------------------------
patches.patchFrameDispatcher(project);

// ----------------------------
// server/dispatchers/browserContextDispatcher.ts
// ----------------------------
patches.patchBrowserContextDispatcher(project);

// ----------------------------
// server/dispatchers/jsHandleDispatcher.ts
// ----------------------------
patches.patchJSHandleDispatcher(project);

// ----------------------------
// server/dispatchers/pageDispatcher.ts
// ----------------------------
patches.patchPageDispatcher(project);

// ----------------------------
// injected/src/xpathSelectorEngine.ts
// ----------------------------
patches.patchXPathSelectorEngine(project);

// ----------------------------
// server/registry/index.ts
// ----------------------------
patches.patchServerRegistryIndex(project);

// ----------------------------
// recorder/src/recorder.tsx
// ----------------------------
patches.patchRecorder(project);

// ----------------------------
// server/screenshotter.ts
// ----------------------------
patches.patchScreenshotter(project);

// ----------------------------
// server/trace/recorder/snapshotter.ts
// ----------------------------
patches.patchSnapshotter(project);

// ----------------------------
// server/trace/recorder/snapshotterInjected.ts
// ----------------------------
patches.patchSnapshotterInjected(project);

// Save the changes without reformatting
project.saveSync();

// ----------------------------
// protocol/protocol.yml
// ----------------------------
// isolatedContext parameters
const protocol = YAML.parse(await fs.readFile("packages/protocol/src/protocol.yml", "utf8"));
for (const type of ["Frame", "JSHandle", "Worker"]) {
  const commands = protocol[type].commands;
  commands.evaluateExpression.parameters.isolatedContext = "boolean?";
  commands.evaluateExpressionHandle.parameters.isolatedContext = "boolean?";
}
protocol["Frame"].commands.evalOnSelectorAll.parameters.isolatedContext = "boolean?";
// focusControl parameter
protocol["ContextOptions"].properties.focusControl = "boolean?";

await fs.writeFile("packages/protocol/src/protocol.yml", YAML.stringify(protocol));
