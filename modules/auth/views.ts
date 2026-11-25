import { html, raw, type Html } from "spacefn";
import { assets } from "spacefn/assets";

import { appearanceHead } from "#modules/appearance/views.ts";

const PROBLEMS = {
	cancelled: "Sign-in was cancelled.",
	expired: "That sign-in expired. Try again.",
	failed: "Couldn't sign in with Google. Try again in a moment.",
	"not-allowed": "That account doesn't have access to this workspace.",
};

/** Why a sign-in didn't work: the `error` in `/login`'s query. */
export type Problem = keyof typeof PROBLEMS;

const isProblem = (value: string): value is Problem => Object.hasOwn(PROBLEMS, value);

// Google's mark, as its branding guidelines ask for on the button.
const GOOGLE_MARK = raw(`<svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
	<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
	<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
	<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
	<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
</svg>`);

/** Signing in without Google, on localhost only (`dev.ts`). */
function devForm(dev: { path: string; emails: string[] }, next: string): Html {
	return html`<form class="login-dev" method="post" action="${dev.path}">
		<p class="login-dev-title">Development sign-in <span>localhost only</span></p>
		<input type="hidden" name="next" value="${next}" />
		<input
			class="login-dev-email"
			name="email"
			type="email"
			list="login-dev-emails"
			required
			aria-label="Email"
			placeholder="Email"
			value="${dev.emails[0] ?? ""}"
		/>
		<datalist id="login-dev-emails">
			${dev.emails.map((email) => html`<option value="${email}"></option>`)}
		</datalist>
		<button class="login-dev-go" type="submit">Sign in</button>
	</form>`;
}

export function loginPage({
	href,
	error,
	next = "/",
	dev = null,
}: {
	href: string;
	error?: string;
	next?: string;
	dev?: { path: string; emails: string[] } | null;
}): Html {
	return html`<!doctype html>
		<html lang="en">
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<title>Sign in · cfnotes</title>
				<link rel="icon" href="/favicon.svg" />
				<link rel="manifest" href="/manifest.webmanifest" />
				<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
				${appearanceHead()} ${assets("site")}
			</head>
			<body>
				<main class="login">
					<h1>cfnotes</h1>
					<p>Sign in to open your notes.</p>
					${
						error && isProblem(error)
							? html`<p class="login-error" role="alert">${PROBLEMS[error]}</p>`
							: ""
					}
					<a class="login-google" href="${href}">${GOOGLE_MARK}<span>Sign in with Google</span></a>
					${dev ? devForm(dev, next) : ""}
				</main>
			</body>
		</html>`;
}

/** Who is signed in, at the foot of the sidebar. */
export function accountView(user: { email: string }): Html {
	return html`<form class="account" method="post" action="/logout" data-sign-out>
		<span class="account-email" title="${user.email}">${user.email}</span>
		<button class="account-out" type="submit">Sign out</button>
	</form>`;
}
