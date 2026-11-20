import assert from "node:assert/strict";
import { test } from "node:test";

// @ts-expect-error The Node test runner resolves this explicit source extension.
import { executePlan, planApply } from "../apply.ts";
// @ts-expect-error The Node test runner resolves this explicit source extension.
import { fields, type Preset } from "../snapshot.ts";
// @ts-expect-error The Node test runner resolves this explicit source extension.
import { parseInventory } from "../collectibles.ts";

function example(name: string, bio = ""): Preset {
    const profile = Object.fromEntries(fields.map(field => [field, { state: "unavailable" }])) as Preset["profile"];
    profile.displayName = { state: "present", value: name };
    profile.bio = bio ? { state: "present", value: bio } : { state: "unset" };
    return { version: 1, id: "b533ae5c-743d-4cc5-ac8f-ec9e3725d552", account: "123456789012345678", name, created: 1, updated: 1, profile, media: {} };
}

test("builds a targeted plan and blocks account mismatches, unavailable fields and cosmetics", () => {
    const current = example("Before");
    const desired = example("After", "Bio");
    desired.profile.profileEffect = { state: "present", value: { id: "123" } };
    desired.profile.themeColors = { state: "present", value: [0, 42] };
    const plan = planApply(current, desired, false);
    assert.deepEqual(plan.operations.map(({ key }) => key), ["global_name", "bio"]);
    assert.ok(plan.results.some(item => item.field === "profileEffect" && item.status === "Invalid or missing preset value"));
    assert.throws(() => planApply(current, { ...desired, account: "987654321098765432" }, false));
});

test("only equips owned, unexpired items of the matching cosmetic type", () => {
    const current = example("Before");
    const desired = example("Before");
    const sku = "123456789012345678";
    const other = "123456789012345679";
    for (const field of ["avatarDecoration", "nameplate", "profileEffect", "profileFrame"] as const) {
        current.profile[field] = { state: "unset" };
        desired.profile[field] = { state: "present", value: { id: sku } };
    }
    const inventory = parseInventory([
        { expires_at: null, items: [{ type: 0, sku_id: sku }, { type: 1, sku_id: sku }, { type: 2, sku_id: other }] },
        { expires_at: "2020-01-01T00:00:00Z", items: [{ type: 2, sku_id: sku }] },
    ]);
    const plan = planApply(current, desired, true, inventory);
    assert.deepEqual(plan.operations.map(({ key }) => key), ["avatar_decoration_sku_id", "profile_effect_id"]);
    assert.ok(plan.results.some(item => item.field === "nameplate" && item.status === "Saved collectible is not available to this account"));
    assert.ok(plan.results.some(item => item.field === "profileFrame" && item.status === "Unsupported"));
    assert.equal(planApply(current, desired, true).operations.length, 0);
    desired.profile.nameplate = { state: "present", value: { skuId: other } };
    assert.ok(planApply(current, desired, true, inventory).operations.some(item => item.key === "nameplate_sku_id"));
});

test("keeps animated images intact and skips uploads without originals", () => {
    const current = example("Before");
    const desired = example("Before");
    current.profile.avatar = { state: "unset" };
    desired.profile.avatar = { state: "present", value: "a_" + "0".repeat(32) };
    assert.equal(planApply(current, desired, true).operations.length, 0);
    desired.media.avatar = { type: "image/gif", data: "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" };
    assert.equal(planApply(current, desired, false).operations.length, 0);
    assert.match(String(planApply(current, desired, true).operations[0].value), /^data:image\/gif;base64,/);
});

test("apply and restore back up before writing and verify against fresh state", async () => {
    let live = example("Before");
    let backup: Preset | undefined;
    const original = live;
    let desired = example("After");
    const io = {
        currentAccount: () => live.account,
        backup: async (preset: Preset) => { backup = preset; },
        read: async () => live,
        write: async () => { assert.equal(backup, live); live = desired; },
    };
    assert.ok((await executePlan(live, desired, planApply(live, desired, true), io)).some(result => result.status === "Applied and verified"));
    assert.equal(backup, original);
    desired = backup!;
    await executePlan(live, desired, planApply(live, desired, true), io);
    assert.equal(live, original);
});

test("a rate limit stops subsequent writes without retrying", async () => {
    const current = example("Before");
    const desired = example("After", "Bio");
    let writes = 0;
    const result = await executePlan(current, desired, planApply(current, desired, true), {
        currentAccount: () => current.account,
        backup: async () => {},
        read: async () => current,
        write: async () => { writes++; throw { status: 429 }; },
    });
    assert.equal(writes, 1);
    assert.ok(result.some(item => item.status === "Rate limited"));
    assert.ok(result.some(item => item.status === "Skipped after interruption"));
});

test("stale previews and failed backups prevent all writes", async () => {
    const current = example("Before");
    const desired = example("After");
    const io = {
        currentAccount: () => current.account,
        backup: async () => { throw new Error("disk full"); },
        read: async () => example("Changed elsewhere"),
        write: async () => assert.fail("unexpected write"),
    };
    await assert.rejects(executePlan(current, desired, planApply(current, desired, false), io), /changed after preview/);
    await assert.rejects(executePlan(current, desired, planApply(current, desired, false), { ...io, read: async () => current }), /disk full/);
});

test("an accepted request with mismatched readback stays unverified", async () => {
    const current = example("Before");
    const desired = example("After");
    const results = await executePlan(current, desired, planApply(current, desired, false), {
        currentAccount: () => current.account,
        backup: async () => {},
        read: async () => current,
        write: async () => {},
    });
    assert.ok(results.some(item => item.field === "displayName" && item.status === "Not verified"));
});
