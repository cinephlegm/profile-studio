import assert from "node:assert/strict";
import { test } from "node:test";

// @ts-expect-error The Node test runner resolves this explicit source extension.
import { executePlan, planApply, profileCollectibleRequest } from "../apply.ts";
// @ts-expect-error The Node test runner resolves this explicit source extension.
import { fields, type Preset } from "../snapshot.ts";
// @ts-expect-error The Node test runner resolves this explicit source extension.
import { type CapturedProfile, parseInventory } from "../collectibles.ts";
// @ts-expect-error The Node test runner resolves this explicit source extension.
import { accountIdentityBody, statusSetting, type CustomStatus } from "../identity.ts";

function example(name: string, bio = ""): CapturedProfile {
    const profile = Object.fromEntries(fields.map(field => [field, { state: "unavailable" }])) as Preset["profile"];
    profile.displayName = { state: "present", value: name };
    profile.bio = bio ? { state: "present", value: bio } : { state: "unset" };
    return { version: 1, id: "b533ae5c-743d-4cc5-ac8f-ec9e3725d552", account: "123456789012345678", name, created: 1, updated: 1, profile, media: {}, profileCollectibles: [] };
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
    assert.deepEqual(plan.operations.map(({ key }) => key), ["avatar_decoration_sku_id", "collectibles_sku_ids"]);
    assert.ok(plan.results.some(item => item.field === "nameplate" && item.status === "Saved collectible is not available to this account"));
    assert.ok(plan.results.some(item => item.field === "profileFrame" && item.status === "Saved collectible is not available to this account"));
    assert.equal(planApply(current, desired, true).operations.length, 0);
    desired.profile.nameplate = { state: "present", value: { skuId: other } };
    assert.ok(planApply(current, desired, true, inventory).operations.some(item => item.key === "nameplate_sku_id"));
});

test("applies an owned frame without touching the effect and restores an explicitly empty frame", async () => {
    const sku = "123456789012345678";
    const effect = "123456789012345679";
    const other = "123456789012345680";
    const before = example("Same");
    before.profile.profileFrame = { state: "unset" };
    before.profile.profileEffect = { state: "present", value: { skuId: effect } };
    before.profileCollectibles = [{ type: 1, sku_id: effect }, { type: 99, sku_id: other }];
    const framed = structuredClone(before);
    framed.profile.profileFrame = { state: "present", value: { sku_id: sku, type: 3 } };
    const inventory = parseInventory([{ items: [{ type: 3, sku_id: sku }] }]);
    let live = before;
    let recovery: Preset | undefined;
    const writes: unknown[] = [];
    const io = {
        currentAccount: () => live.account,
        backup: async (snapshot: Preset) => { recovery = snapshot; },
        read: async () => live,
        write: async (operation: ReturnType<typeof planApply>["operations"][number]) => {
            assert.equal(recovery, live);
            const request = profileCollectibleRequest(operation, live.profileCollectibles)!;
            writes.push(request.body);
            live = { ...(operation.value === null ? before : framed), profileCollectibles: request.items };
        },
    };
    const apply = await executePlan(live, framed, planApply(live, framed, true, inventory), io);
    assert.ok(apply.some(item => item.field === "profileFrame" && item.status === "Applied and verified"));
    assert.equal(recovery, before);
    const desired = recovery!;
    const restore = await executePlan(live, desired, planApply(live, desired, true, inventory), io);
    assert.ok(restore.some(item => item.field === "profileFrame" && item.status === "Applied and verified"));
    assert.deepEqual(writes, [
        { collectibles_sku_ids: [effect, other, sku] },
        { collectibles_sku_ids: [effect, other] },
    ]);
    assert.deepEqual(live.profile.profileEffect, framed.profile.profileEffect);
});

test("old presets without captured frames and frames missing from inventory never write", () => {
    const before = example("Same");
    before.profile.profileFrame = { state: "unset" };
    const desired = example("Same");
    assert.equal(planApply(before, desired, true, new Set()).operations.length, 0);
    desired.profile.profileFrame = { state: "present", value: { sku_id: "123456789012345678" } };
    const plan = planApply(before, desired, true, new Set());
    assert.equal(plan.operations.length, 0);
    assert.ok(plan.results.some(item => item.field === "profileFrame" && item.status === "Saved collectible is not available to this account"));
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

test("applies and restores display-name styles, status, and clan tag using targeted writes", async () => {
    const oldGuild = "123456789012345679";
    const newGuild = "123456789012345680";
    const emoji = "123456789012345681";
    const expiry = String(Date.now() + 60_000);
    const before = example("Same");
    before.profile.primaryGuild = { state: "present", value: { identity_enabled: true, identity_guild_id: oldGuild } };
    before.profile.displayNameStyles = { state: "unset" };
    before.profile.customStatus = { state: "unset" };
    const desired = structuredClone(before);
    desired.profile.primaryGuild = { state: "present", value: { identityEnabled: true, identityGuildId: newGuild } };
    desired.profile.displayNameStyles = { state: "present", value: { font_id: 1, effect_id: 2, colors: [0, 42] } };
    desired.profile.customStatus = { state: "present", value: { text: "Available", emojiId: emoji, emojiName: "leaf", expiresAtMs: expiry } };
    const checks = { canUseGuild: (id: string) => [oldGuild, newGuild].includes(id), canUseEmoji: (id: string) => id === emoji, customStatusAvailable: true };
    let live = structuredClone(before);
    const writes: unknown[] = [];
    let backup: Preset | undefined;
    let target = desired;
    const io = {
        currentAccount: () => live.account,
        backup: async (preset: Preset) => { backup = structuredClone(preset); },
        read: async () => live,
        write: async (op: ReturnType<typeof planApply>["operations"][number]) => {
            assert.ok(backup);
            writes.push(op.route === "status" ? statusSetting(op.value as CustomStatus | null, 1)
                : accountIdentityBody(op.field, op.value) ?? { [op.key]: op.value });
            live = { ...live, profile: { ...live.profile, [op.field]: target.profile[op.field] } };
        },
    };
    const outcomes = await executePlan(live, desired, planApply(live, desired, true, undefined, checks), io);
    assert.ok(outcomes.some(item => item.field === "customStatus" && item.status.includes("server sync unverified")));
    assert.deepEqual(live.profile, desired.profile);
    target = backup as CapturedProfile;
    await executePlan(live, target, planApply(live, target, true, undefined, checks), io);
    assert.deepEqual(live.profile, before.profile);
    assert.deepEqual(writes, [
        { text: "Available", emojiId: emoji, emojiName: "leaf", expiresAtMs: expiry, createdAtMs: "1" },
        { display_name_font_id: 1, display_name_effect_id: 2, display_name_colors: [0, 42] },
        { primary_guild_id: newGuild },
        undefined,
        { display_name_font_id: null, display_name_effect_id: null, display_name_colors: null },
        { primary_guild_id: oldGuild },
    ]);
});

test("checks clan and style eligibility and skips expired status without changing it", () => {
    const current = example("Same");
    current.profile.primaryGuild = current.profile.customStatus = current.profile.displayNameStyles = { state: "unset" };
    const desired = structuredClone(current);
    desired.profile.primaryGuild = { state: "present", value: { identityEnabled: true, identityGuildId: "123456789012345679" } };
    desired.profile.displayNameStyles = { state: "present", value: { fontId: 1, effectId: 2, colors: [42] } };
    desired.profile.customStatus = { state: "present", value: { text: "Expired", expiresAtMs: "123" } };
    const plan = planApply(current, desired, false, undefined, { canUseGuild: () => false, canUseEmoji: () => false, customStatusAvailable: true });
    assert.equal(plan.operations.length, 0);
    assert.ok(plan.results.some(item => item.field === "customStatus" && item.status.includes("expired")));
    assert.ok(plan.results.some(item => item.field === "displayNameStyles" && item.status === "Full Nitro required"));
    assert.ok(plan.results.some(item => item.field === "primaryGuild" && item.status.includes("eligibility")));
});
