import { Project, SyntaxKind } from "ts-morph";

// ----------------------------
// server/dispatchers/browserContextDispatcher.ts
// ----------------------------
export function patchBrowserContextDispatcher(project) {
    // Add source file to the project
    const sourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/dispatchers/browserContextDispatcher.ts");

    // ------- BrowserContextDispatcher Class -------
    const contextDispatcherClass = sourceFile.getClass("BrowserContextDispatcher");

    // -- constructor: patch _dialogHandler to always dispatch dialog events --
    // In driver mode, dialog events can fire before the client's dialog subscription
    // arrives (e.g. popup opens and triggers alert during initialization). Not
    // dispatching the event causes auto-dismissal of the dialog, which is destructive.
    const constructor = contextDispatcherClass.getConstructors()[0];
    const constructorBody = constructor.getBody();
    const dialogHandlerAssignment = constructorBody.getDescendantsOfKind(SyntaxKind.ExpressionStatement).find(stmt =>
        stmt.getText().includes('this._dialogHandler = dialog =>') || stmt.getText().includes('this._dialogHandler =')
    );
    if (dialogHandlerAssignment) {
        dialogHandlerAssignment.replaceWithText(`// patchright - Always dispatch dialog events regardless of subscription state.
    // In driver mode, dialog events can fire before the client's dialog subscription
    // arrives (e.g. popup opens and triggers alert during initialization). Not dispatching
    // the event causes auto-dismissal of the dialog, which is destructive and loses the event.
    this._dialogHandler = dialog => {
      this._dispatchEvent('dialog', { dialog: new DialogDispatcher(this, dialog) });
      return true;
    };`);
    }
}
