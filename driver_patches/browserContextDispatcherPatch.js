import { Project, SyntaxKind } from "ts-morph";

// ----------------------------
// server/dispatchers/browserContextDispatcher.ts
// ----------------------------
export function patchBrowserContextDispatcher(project) {
    // Add source file to the project
    const sourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/dispatchers/browserContextDispatcher.ts");

    // ------- BrowserContextDispatcher Class -------
    const contextDispatcherClass = sourceFile.getClass("BrowserContextDispatcher");

    // -- constructor --
    const constructor = contextDispatcherClass.getConstructors()[0];
    const constructorBody = constructor.getBody();
    const dialogHandlerAssignment = constructorBody.getDescendantsOfKind(SyntaxKind.ExpressionStatement).find(stmt =>
        stmt.getText().includes('this._dialogHandler = dialog =>') || stmt.getText().includes('this._dialogHandler =')
    );
    if (dialogHandlerAssignment) {
        dialogHandlerAssignment.replaceWithText(`
        this._dialogHandler = dialog => {
            this._dispatchEvent('dialog', { dialog: new DialogDispatcher(this, dialog) });
            return true;
        };
        `);
    }
}
