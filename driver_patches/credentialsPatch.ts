import type { Project } from "ts-morph";

// -------------------
// injected/webAuthn.ts
// -------------------
export function patchCredentials(project: Project) {
	const webAuthnSourceFile = project.addSourceFileAtPath("packages/injected/src/webAuthn.ts");
	const injectFunction = webAuthnSourceFile.getFunctionOrThrow("inject");
	// Install the interceptor immediately, then wait for the lazy context's binding wrapper when called.
	injectFunction.getVariableDeclarationOrThrow("binding").setInitializer(`async (payload: any) => {
		while (!(globalThis as any).__pwWebAuthnBinding?.toString().startsWith('(...args) => {'))
			await new Promise(resolve => globalThis.setTimeout(resolve, 0));
		return (globalThis as any).__pwWebAuthnBinding(payload);
	}`);
}
