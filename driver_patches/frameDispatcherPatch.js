import { Project, SyntaxKind } from "ts-morph";

// ----------------------------
// server/dispatchers/frameDispatcher.ts
// ----------------------------
export function patchFrameDispatcher(project) {
    // Add source file to the project
    const frameDispatcherSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/dispatchers/frameDispatcher.ts");

    // ------- frameDispatcher Class -------
    const frameDispatcherClass = frameDispatcherSourceFile.getClass("FrameDispatcher");

    // -- evaluateExpression Method --
    const frameEvaluateExpressionMethod = frameDispatcherClass.getMethod("evaluateExpression");
    frameEvaluateExpressionMethod.setBodyText(`
      return { value: serializeResult(await progress.race(this._frame.evaluateExpression(params.expression, { isFunction: params.isFunction, world: params.isolatedContext ? 'utility': 'main' }, parseArgument(params.arg)))) };
    `);

    // -- evaluateExpressionHandle Method --
    const frameEvaluateExpressionHandleMethod = frameDispatcherClass.getMethod("evaluateExpressionHandle");
    frameEvaluateExpressionHandleMethod.setBodyText(`
      return { handle: ElementHandleDispatcher.fromJSOrElementHandle(this, await progress.race(this._frame.evaluateExpressionHandle(params.expression, { isFunction: params.isFunction, world: params.isolatedContext ? 'utility': 'main' }, parseArgument(params.arg)))) };
    `);

    // -- evaluateExpression Method --
    const frameEvalOnSelectorAllExpressionMethod = frameDispatcherClass.getMethod("evalOnSelectorAll");
    frameEvalOnSelectorAllExpressionMethod.setBodyText(`
      return { value: serializeResult(await this._frame.evalOnSelectorAll(params.selector, params.expression, params.isFunction, parseArgument(params.arg), null, params.isolatedContext)) };
    `);
}