import { cosmeticTypes, equipped, type Inventory, isCosmetic } from "./collectibles";
import { fields, type FieldName, type Preset, validMedia } from "./snapshot";

const routes = {
    displayName: ["account", "global_name", 32],
    avatar: ["account", "avatar", 0],
    banner: ["account", "banner", 0],
    bio: ["profile", "bio", 190],
    pronouns: ["profile", "pronouns", 40],
    themeColors: ["profile", "theme_colors", 0],
    avatarDecoration: ["account", "avatar_decoration_sku_id", 0],
    nameplate: ["account", "nameplate_sku_id", 0],
    profileEffect: ["profile", "profile_effect_id", 0],
} as const;

type Route = "account" | "profile";
type Payload = string | null | number[];
export type Result = { field: FieldName; status: string; };
type Operation = { field: FieldName; route: Route; key: string; value: Payload; };
type Plan = { operations: Operation[]; results: Result[]; };

export function sameField(left: Preset, right: Preset, field: FieldName) {
    const before = left.profile[field];
    const after = right.profile[field];
    if (before.state !== after.state) return false;
    if (before.state !== "present" || after.state !== "present") return true;
    if (isCosmetic(field)) {
        const id = equipped(left, field);
        return id !== undefined && id === equipped(right, field);
    }
    if (JSON.stringify(before.value) === JSON.stringify(after.value)) return true;
    if (field !== "avatar" && field !== "banner") return false;
    const media = left.media[field];
    return Boolean(media && media.type === right.media[field]?.type && media.data === right.media[field]?.data);
}

function payload(preset: Preset, field: keyof typeof routes): Payload | undefined {
    if (isCosmetic(field)) return equipped(preset, field);
    const entry = preset.profile[field];
    if (entry.state === "unset") return field === "bio" || field === "pronouns" ? "" : null;
    if (entry.state !== "present") return;
    if (field === "avatar" || field === "banner") {
        const asset = preset.media[field];
        if (!validMedia(asset) || asset.data.length > 13_333_332 || typeof entry.value !== "string"
            || entry.value.startsWith("a_") !== (asset.type === "image/gif")) return;
        return `data:${asset.type};base64,${asset.data}`;
    }
    if (field === "themeColors") {
        if (Array.isArray(entry.value) && entry.value.length === 2
            && entry.value.every(color => typeof color === "number" && Number.isInteger(color) && color >= 0 && color <= 0xffffff)) {
            return entry.value as number[];
        }
        return;
    }
    if (typeof entry.value === "string" && entry.value.length <= routes[field][2]) return entry.value;
}

export function planApply(current: Preset, desired: Preset, fullNitro: boolean, inventory?: Inventory): Plan {
    if (current.account !== desired.account) throw new Error("This preset belongs to another Discord account.");
    const operations: Operation[] = [];
    const results: Result[] = [];
    for (const field of fields) {
        const report = (status: string) => results.push({ field, status });
        if (field === "username") { report("Read-only"); continue; }
        const state = desired.profile[field].state;
        if (state !== "present" && state !== "unset") { report("Unavailable in preset"); continue; }
        if (sameField(current, desired, field)) { report("Already matches"); continue; }
        if (!Object.hasOwn(routes, field)) { report("Unsupported"); continue; }
        const supported = field as keyof typeof routes;
        const value = payload(desired, supported);
        const recovery = payload(current, supported);
        if (value === undefined) { report("Invalid or missing preset value"); continue; }
        if (recovery === undefined) { report("Current value could not be backed up"); continue; }
        if (isCosmetic(field)) {
            if (!inventory) { report("Could not verify collectible ownership"); continue; }
            if (value !== null && !inventory.has(`${cosmeticTypes[field]}:${value}`)) { report("Saved collectible is not available to this account"); continue; }
            if (recovery !== null && !inventory.has(`${cosmeticTypes[field]}:${recovery}`)) { report("Current collectible could not be restored"); continue; }
        }
        if (!fullNitro && (field === "banner" || field === "themeColors"
            || field === "avatar" && (desired.media.avatar?.type === "image/gif" || current.media.avatar?.type === "image/gif"))) {
            report("Full Nitro required"); continue;
        }
        const [route, key] = routes[supported];
        operations.push({ field, route, key, value });
    }
    return { operations, results };
}

type ApplyIO = {
    currentAccount(): string | undefined;
    backup(preset: Preset): Promise<void>;
    write(operation: Operation): Promise<void>;
    read(): Promise<Preset>;
};

export async function executePlan(current: Preset, desired: Preset, plan: Plan, io: ApplyIO): Promise<Result[]> {
    const results = [...plan.results];
    if (!plan.operations.length) return results;
    const assertAccount = () => {
        if (io.currentAccount() !== desired.account) throw new Error("The active Discord account changed.");
    };
    assertAccount();
    const fresh = await io.read();
    if (fresh.account !== current.account || plan.operations.some(({ field }) => !sameField(current, fresh, field))) {
        throw new Error("Your profile changed after preview. Open Apply or Restore again.");
    }
    assertAccount();
    await io.backup(fresh);
    const accepted: Operation[] = [];
    let stopped = false;
    for (const operation of plan.operations) {
        if (stopped || io.currentAccount() !== desired.account) {
            results.push({ field: operation.field, status: "Skipped after interruption" });
            continue;
        }
        try {
            await io.write(operation);
            accepted.push(operation);
        } catch (error) {
            const status = (error as { status?: number; } | null)?.status;
            results.push({ field: operation.field, status: status === 429 ? "Rate limited" : status && status < 500 ? "Rejected" : "Failed" });
            stopped = true;
        }
    }
    if (accepted.length) {
        let verified: Preset | undefined;
        try {
            assertAccount();
            verified = await io.read();
        } catch {
            // A successful request alone does not verify the resulting profile.
        }
        for (const { field } of accepted) {
            const matched = verified?.account === desired.account && sameField(desired, verified, field);
            results.push({ field, status: matched ? "Applied and verified" : "Not verified" });
        }
    }
    return results;
}
