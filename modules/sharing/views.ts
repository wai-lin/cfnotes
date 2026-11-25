import { html, type Html } from "spacefn";
import { assets } from "spacefn/assets";

import { appearanceHead } from "#modules/appearance/views.ts";
import { accountView } from "#modules/auth/views.ts";

/** `/` for a friend with nothing shared with them (any more). */
export function nothingShared(user: { email: string }): Html {
	return html`<!doctype html>
		<html lang="en">
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<title>Nothing shared · cfnotes</title>
				<link rel="icon" href="/favicon.svg" />
				${appearanceHead()} ${assets("site")}
			</head>
			<body>
				<main class="login">
					<h1>cfnotes</h1>
					<p>Nothing is shared with you right now.</p>
					${accountView(user)}
				</main>
			</body>
		</html>`;
}
