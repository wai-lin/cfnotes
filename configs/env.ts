// Deploys import this file to know which variables to pass on, so it imports only spacefn and effect.
import { Schema } from "effect";
import { defineEnv, Env } from "spacefn";

const text = (pattern: RegExp) => Env.schema(Schema.String.check(Schema.isPattern(pattern)));

export default defineEnv({
	/** Where the app is reached, with no trailing slash: https, or http on localhost. */
	ORIGIN: text(/^(https:\/\/[^/\s?#@]+|http:\/\/localhost(:\d+)?)$/),
	/** The OAuth client from Google Cloud's "Google Auth Platform". */
	GOOGLE_CLIENT_ID: text(/^\S+$/),
	GOOGLE_CLIENT_SECRET: Env.secret(),
	/** Who may sign in, separated by commas or spaces. They all share the one workspace. */
	ALLOWED_EMAILS: text(/^[^\s,@]+@[^\s,@]+([\s,]+[^\s,@]+@[^\s,@]+)*$/),
});
