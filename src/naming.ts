/** Sanitizes a name into a free filename, appending " 2", " 3", ... on collision per `exists`. */
export function uniqueFileName(
	name: string,
	exists: (candidate: string) => boolean,
): string {
	const safe = name.replace(/[\\/:*?"<>|]/g, "-").trim() || "Path";
	let candidate = safe;
	let n = 2;
	while (exists(candidate)) candidate = `${safe} ${n++}`;
	return candidate;
}

/** Renames a Record's key in place, preserving the insertion order of the other entries. */
export function renameKey<T>(
	record: Record<string, T>,
	from: string,
	to: string,
): void {
	const renamed: Record<string, T> = {};
	for (const [key, value] of Object.entries(record)) {
		renamed[key === from ? to : key] = value;
	}
	for (const key of Object.keys(record)) delete record[key];
	Object.assign(record, renamed);
}

/** First free key: `base` itself, or `"${base} 2"`, `"${base} 3"`, ... on collision. */
export function uniqueKey(
	record: Record<string, unknown>,
	base: string,
): string {
	if (!(base in record)) return base;
	let n = 2;
	while (`${base} ${n}` in record) n++;
	return `${base} ${n}`;
}
