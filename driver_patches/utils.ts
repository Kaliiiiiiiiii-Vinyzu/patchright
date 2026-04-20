export function assertDefined<T>(value: T | undefined | null, name?: string): T {
	if (value == null) throw new Error(`Required value${name ? ` "${name}"` : ""} is null or undefined`);
	return value;
}