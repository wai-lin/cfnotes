/** Who may come in, and where they go once they have. */

// Only A-Z: toLowerCase() also folds other letters into ASCII (the Kelvin sign into "k").
export const normalize = (email: string) =>
	email.replace(/[A-Z]/g, (letter) => letter.toLowerCase());

/** The emails in `list` (separated by commas or spaces), case-folded, without repeats. */
export const emails = (list: string): string[] => [
	...new Set(
		list
			.split(/[\s,]+/)
			.filter(Boolean)
			.map(normalize),
	),
];

/** Whether `email` is one of `list`. */
export const isAllowed = (list: string, email: string) => emails(list).includes(normalize(email));

/** `path` if it is a page of this app, for going back to after sign-in, else `/`. */
export const returnPath = (path = "") => (/^\/(p\/[\w-]+|trash)$/.test(path) ? path : "/");
