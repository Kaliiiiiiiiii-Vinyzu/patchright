import { type Project, SyntaxKind } from "ts-morph";
import { assertDefined } from "./utils.ts";

// ----------------------------------------
// server/chromium/chromium.ts (call site)
// ----------------------------------------
export function patchChromiumLaunchArgs(project: Project) {
	const chromiumSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/chromium/chromium.ts");

	// Find the chromiumSwitches(...) call in _innerDefaultArgs
	const chromiumSwitchesCall = assertDefined(
		chromiumSourceFile
			.getDescendantsOfKind(SyntaxKind.CallExpression)
			.find(call =>
				call.getExpression().getText() === "chromiumSwitches" &&
				call.getArguments().length === 2
			)
	);

	// Replace chromiumSwitches(options.assistantMode, options.channel)
	// with    chromiumSwitches(options.assistantMode, options.channel, undefined, options.disablePopupBlocking)
	chromiumSwitchesCall.replaceWithText(
		"chromiumSwitches(options.assistantMode, options.channel, undefined, options.disablePopupBlocking)"
	);
}
