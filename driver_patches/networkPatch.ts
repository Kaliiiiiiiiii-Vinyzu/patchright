import { type Project, Scope } from "ts-morph";

// -----------------
// server/network.ts
// -----------------
export function patchNetwork(project: Project) {
	const networkSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/network.ts");
	const requestClass = networkSourceFile.getClassOrThrow("Request");
	const rawHeadersPromise = requestClass.getPropertyOrThrow("_rawRequestHeadersPromise");
	requestClass.insertProperty(requestClass.getMembers().indexOf(rawHeadersPromise), {
		name: "_rawRequestHeaders",
		type: "HeadersArray | undefined",
		scope: Scope.Private,
	});

	requestClass.getMethodOrThrow("setRawRequestHeaders").setBodyText(`
		const rawHeaders = headers || this._headers;
		this._rawRequestHeaders = rawHeaders;
		if (!this._rawRequestHeadersPromise.isDone())
			this._rawRequestHeadersPromise.resolve(rawHeaders);
	`);

	requestClass.getMethodOrThrow("internalRawRequestHeaders").setBodyText(`
		return this._overrides?.headers || this._rawRequestHeaders || this._rawRequestHeadersPromise;
	`);
}
