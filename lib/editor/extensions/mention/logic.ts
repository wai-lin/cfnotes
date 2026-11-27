/** `@` opens the people picker; the text typed after it filters them. */
export const MENTION_TRIGGER = { pattern: /(?:^|[\s(])@([\w.+-]{0,40})$/, prefix: "@" };

export const MAX_PEOPLE = 8;

/** Someone who can be mentioned. */
export interface Person {
	email: string;
	/** How the mention reads (`@name`). */
	name: string;
}

/** The address a mention links to. */
export const mentionUrl = (email: string) => `mailto:${email}`;

/** The email a mention's link is to, or `null` when the link isn't one. */
export function mentionEmail(url: string, text: string): string | null {
	if (!text.startsWith("@") || !/^mailto:/i.test(url)) return null;
	return url.slice("mailto:".length) || null;
}

/** People whose name or email starts with `query`, then those containing it. */
export function rankPeople(people: readonly Person[], query: string): Person[] {
	const q = query.trim().toLowerCase();
	if (!q) return people.slice(0, MAX_PEOPLE);
	const starts: Person[] = [];
	const contains: Person[] = [];
	for (const person of people) {
		const name = person.name.toLowerCase();
		const email = person.email.toLowerCase();
		if (name.startsWith(q) || email.startsWith(q)) starts.push(person);
		else if (name.includes(q) || email.includes(q)) contains.push(person);
	}
	return [...starts, ...contains].slice(0, MAX_PEOPLE);
}
