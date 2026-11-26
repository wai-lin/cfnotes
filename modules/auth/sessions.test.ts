import { Effect, Layer, Option } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { TestClock } from "effect/testing";
import { testDb, testEnv } from "spacefn/testing";
import { describe, expect, it } from "vitest";

import Env from "#configs/env.ts";
import { cookiesOf, TEST_ENV } from "#lib/testing.ts";
import MainDb from "#space/db/main.ts";

import * as Sessions from "./sessions.ts";

const envLayer = (env: typeof TEST_ENV) => Env.layer.pipe(Layer.provide(testEnv(env)));

/** Runs on a fresh database and a clock the test moves. */
const run = <A, E>(test: Effect.Effect<A, E, MainDb | Layer.Success<typeof Env.layer>>) =>
	Effect.runPromise(
		test.pipe(
			Effect.provide(Layer.mergeAll(testDb(MainDb), envLayer(TEST_ENV), TestClock.layer())),
		),
	);

// A new request each time, as the user is cached per request.
const requestWith = (cookie = "") =>
	Effect.provideService(
		HttpServerRequest.HttpServerRequest,
		HttpServerRequest.fromWeb(new Request("http://app.test/", { headers: { cookie } })),
	);

const signedIn = Effect.gen(function* () {
	const response = yield* Sessions.start("owner@example.com", "/").pipe(requestWith());
	return cookiesOf(HttpServerResponse.toWeb(response));
});

const works = (cookie: string) =>
	Effect.map(Sessions.user.pipe(requestWith(cookie)), Option.isSome);

describe("sessions", () => {
	it("end after 7 idle days", () =>
		run(
			Effect.gen(function* () {
				const cookie = yield* signedIn;
				yield* TestClock.adjust("6 days");
				expect(yield* works(cookie)).toBe(true); // and that counts as use
				yield* TestClock.adjust("6 days");
				expect(yield* works(cookie)).toBe(true);
				yield* TestClock.adjust("7 days");
				expect(yield* works(cookie)).toBe(false);
			}),
		));

	it("end after 30 days, however much they're used", () =>
		run(
			Effect.gen(function* () {
				const cookie = yield* signedIn;
				for (let week = 0; week < 5; week++) {
					yield* TestClock.adjust("5 days");
					expect(yield* works(cookie)).toBe(true);
				}
				yield* TestClock.adjust("5 days");
				expect(yield* works(cookie)).toBe(false);
			}),
		));

	it("end when the email is taken off the list", () =>
		run(
			Effect.gen(function* () {
				const cookie = yield* signedIn;
				const without = { ...(yield* Env), ALLOWED_EMAILS: "someone@example.com" };
				expect(yield* works(cookie).pipe(Effect.provideService(Env, without))).toBe(false);
			}),
		));

	it("are purged once they've ended, and no sooner", () =>
		run(
			Effect.gen(function* () {
				const stored = (tokenHash: string) =>
					Effect.map(MainDb.sessions.find({ tokenHash }), Option.isSome);
				const add = (tokenHash: string, expiresAt: number, now: number) =>
					MainDb.sessions.create({ tokenHash, email: "owner@example.com", expiresAt, now });
				const day = 24 * 60 * 60 * 1000;
				yield* TestClock.adjust("10 days");
				yield* add("expired", 10 * day, 9 * day);
				yield* add("idle", 20 * day, 3 * day);
				yield* add("live", 20 * day, 3 * day + 1);

				yield* Sessions.purgeJob;
				expect(yield* stored("expired")).toBe(false);
				expect(yield* stored("idle")).toBe(false);
				expect(yield* stored("live")).toBe(true);
			}),
		));
});
