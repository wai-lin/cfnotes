/** Who may come in, and where they go once they have. */

// Only A-Z: toLowerCase() also folds other letters into ASCII (the Kelvin sign into "k").
const normalize = (email: string) => email.replace(/[A-Z]/g, (letter) => letter.toLowerCase());

/** Whether `email` is one of `list` (separated by commas or spaces). */
export const isAllowed = (list: string, email: string) =>
	list
		.split(/[\s,]+/)
		.filter(Boolean)
		.map(normalize)
		.includes(normalize(email));

/** `path` if it is a page of this app, for going back to after sign-in, else `/`. */
export const returnPath = (path = "") => (/^\/(p\/[\w-]+|trash)$/.test(path) ? path : "/");
