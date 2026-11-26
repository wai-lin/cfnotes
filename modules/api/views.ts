import { html, raw, type Html } from "spacefn";
import { assets } from "spacefn/assets";

import { icon } from "#lib/icons.ts";
import { appearanceHead } from "#modules/appearance/views.ts";
import { MAX_FRIEND_TOKENS, type TokenInfo } from "#modules/auth/tokens.ts";

import { FRIEND_LIMITS } from "./limits.ts";

const day = (ms: number, now: number) => {
	const when = new Date(ms);
	return when.toLocaleDateString("en", {
		month: "short",
		day: "numeric",
		...(when.getFullYear() === new Date(now).getFullYear() ? {} : { year: "numeric" }),
	});
};

/** The page that makes and revokes API tokens, and says how to use them. */
export function tokensView({
	origin,
	tokens,
	me,
	now,
	made,
	error,
	urls,
	guest = false,
}: {
	origin: string;
	tokens: readonly TokenInfo[];
	me: string | null;
	now: number;
	/** A token just made: the only time it's shown. */
	made: { name: string; scope: string; token: string } | undefined;
	error: string | undefined;
	urls: Record<"create" | "revoke", string>;
	/** A friend's page: their own tokens, which reach only what's shared with them. */
	guest?: boolean;
}): Html {
	const mcp = `${origin}/api/mcp`;
	return html`<article class="page tokens-page">
		<header class="page-bar"></header>
		<h1 class="page-title">API tokens</h1>
		<p class="page-intro">
			A token lets your website, scripts and AI agents use this workspace through the API at
			<code>${origin}/api/v1</code> and the MCP server at <code>${mcp}</code>. It acts as the person
			who made it, so keep it secret like a password. Nothing becomes public.
			<a href="/docs/api">Read the API and MCP docs</a>.
		</p>
		${
			guest
				? html`<p class="page-intro">
						Yours reach only what's shared with you, as you can in the app. You can have
						${MAX_FRIEND_TOKENS} tokens, and together they make up to ${FRIEND_LIMITS.perMinute}
						requests a minute and ${FRIEND_LIMITS.perDay.toLocaleString("en")} a day.
					</p>`
				: ""
		}
		${
			made
				? html`<section class="token-made" role="status">
						<h2>${made.name}: copy your token now</h2>
						<p>You won't see it again. If you lose it, revoke it and make a new one.</p>
						<div class="token-copy">
							<input
								class="input token-value"
								readonly
								value="${made.token}"
								aria-label="The new token"
								onfocus="this.select()"
							/>
							<button class="btn" type="button" data-copy="${made.token}">
								${raw(icon("copy"))}<span>Copy</span>
							</button>
						</div>
						<h3>Try it</h3>
						<pre><code>curl -H "Authorization: Bearer ${made.token}" ${origin}/api/v1/pages</code></pre>
						<h3>Connect Claude Code</h3>
						<pre><code>claude mcp add --transport http cfnotes ${mcp} --header "Authorization: Bearer ${made.token}"</code></pre>
					</section>`
				: ""
		}

		<form class="token-new" method="post" action="${urls.create}">
			<h2>New token</h2>
			${error ? html`<p class="notice" role="alert">${error}</p>` : ""}
			<label class="field token-name">
				<span class="field-label">Name</span>
				<input
					class="input"
					name="name"
					required
					maxlength="80"
					placeholder="Blog build, Claude…"
					autocomplete="off"
				/>
			</label>
			<fieldset class="choices token-scope">
				<legend class="field-label">Access</legend>
				<label class="choice">
					<input type="radio" name="scope" value="read" checked />
					<span>
						<span class="choice-title">Read only</span>
						<span class="choice-text">Read pages, databases and comments.</span>
					</span>
				</label>
				<label class="choice">
					<input type="radio" name="scope" value="write" />
					<span>
						<span class="choice-title">Read and write</span>
						<span class="choice-text">Also create and change pages, properties and comments.</span>
					</span>
				</label>
			</fieldset>
			<button class="btn is-primary" type="submit">
				${raw(icon("key"))}<span>Make token</span>
			</button>
		</form>

		<h2 class="tokens-heading">Tokens</h2>
		${
			tokens.length === 0
				? html`<p class="page-empty">No tokens yet.</p>`
				: html`<ul class="trash-list token-list">
						${tokens.map(
							(token) =>
								html`<li class="trash-item token-item">
									${raw(icon("key", 18))}
									<div class="trash-main">
										<div class="trash-title">${token.name}</div>
										<div class="trash-meta">
											${token.scope === "write" ? "Read and write" : "Read only"} ·
											${token.createdBy === me ? "Yours" : token.createdBy} · Made
											${day(token.createdAt, now)} ·
											${token.lastUsedAt ? `Last used ${day(token.lastUsedAt, now)}` : "Never used"}
										</div>
									</div>
									<form
										method="post"
										action="${urls.revoke}"
										data-confirm="Revoke “${token.name}”?"
										data-confirm-message="Anything using it stops working."
										data-confirm-label="Revoke"
									>
										<input type="hidden" name="id" value="${token.id}" />
										<button class="ghost is-danger" type="submit">Revoke</button>
									</form>
								</li>`,
						)}
					</ul>`
		}
		<script>
			document.addEventListener("click", (event) => {
				const button = event.target.closest?.("[data-copy]");
				if (!button) return;
				navigator.clipboard.writeText(button.dataset.copy).then(() => {
					button.querySelector("span").textContent = "Copied";
				});
			});
		</script>
	</article>`;
}

/** The public docs page: `body` is the docs as HTML, drawn from `docs/api.md`. */
export function docsPage({ title, body }: { title: string; body: string }): Html {
	return html`<!doctype html>
		<html lang="en">
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<title>${title} · cfnotes</title>
				<link rel="icon" href="/favicon.svg" />
				<link rel="alternate" type="text/markdown" href="/docs/api.md" />
				${appearanceHead()} ${assets("site")}
			</head>
			<body>
				<main class="docs">
					<p class="docs-note">
						For agents, the same docs as Markdown: <a href="/docs/api.md">/docs/api.md</a>
					</p>
					${raw(body)}
				</main>
			</body>
		</html>`;
}
