import { Project, SyntaxKind } from "ts-morph";

// ----------------------------
// server/chromium/crServiceWorker.ts
// ----------------------------
export function patchCRServiceWorker(project) {
    // Add source file to the project
    const crServiceWorkerSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/chromium/crServiceWorker.ts");

    // ------- CRServiceWorker Class -------
    const crServiceWorkerClass = crServiceWorkerSourceFile.getClass("CRServiceWorker");

    // -- CRServiceWorker Constructor --
    const crServiceWorkerConstructorDeclaration = crServiceWorkerClass
      .getConstructors()
      .find((ctor) =>
        ctor
          .getText()
          .includes("constructor(browserContext: CRBrowserContext, session: CRSession, url: string)")
      );
    const crServiceWorkerConstructorBody = crServiceWorkerConstructorDeclaration.getBody();
    // Find the Runtime.enable statement to remove
    const statementToRemove = crServiceWorkerConstructorBody
      .getStatements()
      .find((statement) =>
        statement
          .getText()
          .includes("session.send('Runtime.enable', {}).catch(e => { });")
      );
    if (statementToRemove) statementToRemove.remove();

    crServiceWorkerConstructorBody.addStatements(`
      session._sendMayFail("Runtime.evaluate", {
        expression: "globalThis",
        serializationOptions: { serialization: "idOnly" }
      }).then(globalThis => {
        if (globalThis && globalThis.result) {
          var globalThisObjId = globalThis.result.objectId;
          var executionContextId = parseInt(globalThisObjId.split(".")[1], 10);
          this.createExecutionContext(new CRExecutionContext(session, { id: executionContextId }));
        }
      });
    `);
}