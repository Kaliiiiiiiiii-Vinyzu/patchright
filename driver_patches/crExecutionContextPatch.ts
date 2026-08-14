import type { Project } from "ts-morph";

// ------------------------------------
// server/chromium/crExecutionContext.ts
// ------------------------------------
export function patchCRExecutionContext(project: Project) {
	const crExecutionContextSourceFile = project.addSourceFileAtPath(
		"packages/playwright-core/src/server/chromium/crExecutionContext.ts",
	);
	const crExecutionContextClass = crExecutionContextSourceFile.getClassOrThrow("CRExecutionContext");

	crExecutionContextClass.addMethod({
		name: "findFunctions",
		isAsync: true,
		parameters: [
			{ name: "context", type: "js.ExecutionContext" },
			{ name: "name", type: "string" },
		],
		returnType: "Promise<js.JSHandle[]>",
		statements: `
			if (!/^f[0-9a-f]{32}$/.test(name))
				return [];
			const objectIds = new Set<Protocol.Runtime.RemoteObjectId>();
			try {
				const literal = await this._client.send('Runtime.evaluate', {
					expression: '(() => {})',
					contextId: this._contextId,
				});
				if (!literal.result.objectId)
					return [];
				objectIds.add(literal.result.objectId);
				const literalProperties = await this._client.send('Runtime.getProperties', {
					objectId: literal.result.objectId,
					ownProperties: true,
				});
				const prototype = literalProperties.internalProperties?.find(property => property.name === '[[Prototype]]')?.value;
				if (!prototype?.objectId)
					return [];
				objectIds.add(prototype.objectId);
				const { objects } = await this._client.send('Runtime.queryObjects', {
					prototypeObjectId: prototype.objectId,
				});
				if (!objects.objectId)
					return [];
				objectIds.add(objects.objectId);
				const properties = await this._client.send('Runtime.getProperties', {
					objectId: objects.objectId,
					ownProperties: true,
				});
				const handles: js.JSHandle[] = [];
				for (const property of properties.result) {
					const candidate = property.value;
					if (!candidate?.objectId)
						continue;
					objectIds.add(candidate.objectId);
					if (candidate.type !== 'function' || !candidate.description?.startsWith('function callbackBridge('))
						continue;
					const candidateProperties = await this._client.send('Runtime.getProperties', {
						objectId: candidate.objectId,
						ownProperties: true,
					});
					for (const candidateProperty of candidateProperties.result) {
						if (candidateProperty.value?.objectId)
							objectIds.add(candidateProperty.value.objectId);
					}
					for (const internalProperty of candidateProperties.internalProperties || []) {
						if (internalProperty.value?.objectId)
							objectIds.add(internalProperty.value.objectId);
					}
					if (!candidateProperties.result.some(property => property.name === name && property.value?.value === true))
						continue;
					objectIds.delete(candidate.objectId);
					handles.push(createHandle(context, candidate));
				}
				return handles;
			} finally {
				await Promise.all([...objectIds].map(objectId => releaseObject(this._client, objectId)));
			}
		`,
	});
}
