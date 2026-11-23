import { html, raw, type Html } from "spacefn";

import { icon } from "#lib/icons.ts";
import type { TokenInfo } from "#modules/auth/tokens.ts";

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
}: {
	origin: string;
	tokens: readonly TokenInfo[];
	me: string | null;
	now: number;
	/** A token just made: the only time it's shown. */
	made: { name: string; scope: string; token: string } | undefined;
	error: string | undefined;
	urls: Record<"create" | "revoke", string>;
}): Html {
	const mcp = `${origin}/api/mcp`;
	return html`<article class="page tokens-page">
		<header class="page-bar"></header>
		<h1 class="page-title">API tokens</h1>
		<p class="tokens-intro">
			A token lets your website, scripts and AI agents use this workspace through the API at
			<code>${origin}/api/v1</code> and the MCP server at <code>${mcp}</code>. It acts as the person
			who made it, so keep it secret like a password. Nothing becomes public.
		</p>

		${
			made
				? html`<section class="token-made" role="status">
						<h2>${made.name}: copy your token now</h2>
						<p>You won't see it again. If you lose it, revoke it and make a new one.</p>
						<div class="token-copy">
							<input
								class="token-value"
								readonly
								value="${made.token}"
								aria-label="The new token"
								onfocus="this.select()"
							/>
							<button class="ghost" type="button" data-copy="${made.token}">
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
			${error ? html`<p class="token-error" role="alert">${error}</p>` : ""}
			<label class="token-field">
				<span>Name</span>
				<input name="name" required maxlength="80" placeholder="Blog build, Claude…" />
			</label>
			<fieldset class="token-scope">
				<legend>Access</legend>
				<label><input type="radio" name="scope" value="read" checked /> Read only</label>
				<label>
					<input type="radio" name="scope" value="write" /> Read and write: create and change pages,
					properties and comments
				</label>
			</fieldset>
			<button type="submit">${raw(icon("key"))}<span>Make token</span></button>
		</form>

		<h2 class="tokens-heading">Tokens</h2>
		${
			tokens.length === 0
				? html`<p class="tokens-empty">No tokens yet.</p>`
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
