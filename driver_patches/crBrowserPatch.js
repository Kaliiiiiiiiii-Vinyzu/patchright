import { Project, SyntaxKind } from "ts-morph";

// ----------------------------
// server/chromium/crBrowser.ts
// ----------------------------
export function patchCRBrowser(project) {
    // Add source file to the project
    const crBrowserSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/chromium/crBrowser.ts");

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
    doRemoveInitScriptsMethod.setBodyText(`
      for (const page of this.pages()) await (page.delegate as CRPage).removeInitScripts();
    `);


    // ------- CRBrowserContext Class -------
    const crBrowserClass = crBrowserSourceFile.getClass("CRBrowserContext");

    // -- doExposeBinding Method --
    crBrowserClass.addMethod({
      name: "doExposeBinding",
      isAsync: true,
      parameters: [{ name: "binding", type: "PageBinding" }],
    });
    const doExposeBindingMethod = crBrowserClass.getMethod("doExposeBinding");
    doExposeBindingMethod.setBodyText(`
      for (const page of this.pages()) await (page.delegate as CRPage).exposeBinding(binding);
    `);

    // -- doRemoveExposedBindings Method --
    crBrowserClass.addMethod({
      name: "doRemoveExposedBindings",
      isAsync: true,
    });
    const doRemoveExposedBindingsMethod = crBrowserClass.getMethod(
      "doRemoveExposedBindings",
    );
    doRemoveExposedBindingsMethod.setBodyText(`
      for (const page of this.pages()) await (page.delegate as CRPage).removeExposedBindings();
    `);
}