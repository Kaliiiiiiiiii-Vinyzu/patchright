import type { Project } from "ts-morph";

// ---------------------
// server/credentials.ts
// ---------------------
export function patchCredentials(project: Project) {
	// Add source file to the project
	const credentialsSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/credentials.ts");

	// ------- Credentials Class -------
	const credentialsClass = credentialsSourceFile.getClassOrThrow("Credentials");

	// -- install Method --
	const installMethod = credentialsClass.getMethodOrThrow("install");
	const scriptDeclaration = installMethod.getVariableDeclarationOrThrow("script");
	scriptDeclaration.setInitializer("`(() => {\n      const module = {};\n      ${rawWebAuthnSource.source}\n      const installWebAuthn = () => {\n        if (!globalThis.__pwWebAuthnBinding) {\n          setTimeout(installWebAuthn, 0);\n          return;\n        }\n        module.exports.inject()(globalThis);\n      };\n      installWebAuthn();\n    })();`");
}
