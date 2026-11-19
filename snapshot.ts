export const fields = [
    "username", "displayName", "avatar", "banner", "bio", "pronouns", "customStatus",
    "accentColor", "themeColors", "displayNameStyles", "avatarDecoration", "profileEffect",
    "profileFrame", "nameplate", "primaryGuild", "connectionVisibility"
] as const;
export type FieldName = typeof fields[number];
type Value = string | number | boolean | null | Value[] | { [key: string]: Value };
export type Field = { state: "present"; value: Value; } | { state: "unset" | "unavailable" | "failed"; };
export type Media = { type: "image/png" | "image/gif"; data: string; };
export type Preset = {
    version: 1;
    id: string;
    account: string;
    name: string;
    created: number;
    updated: number;
    profile: Record<FieldName, Field>;
    media: Partial<Record<"avatar" | "banner", Media>>;
};

export function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function captureField(value: unknown, keys?: readonly string[]): Field {
    if (value === undefined) return { state: "unavailable" };
    if (value === null || value === "") return { state: "unset" };
    if (keys && (!value || typeof value !== "object" || Array.isArray(value))) return { state: "failed" };
    const selected = keys
        ? Object.fromEntries(keys.filter(key => Object.hasOwn(record(value), key)).map(key => [key, record(value)[key]]))
        : value;
    if (keys && !Object.keys(record(selected)).length) return { state: "unavailable" };
    if (!validValue(selected)) return { state: "failed" };
    return { state: "present", value: selected };
}

const safeKeys = new Set([
    "text", "emojiId", "emojiName", "expiresAtMs", "font_id", "fontId", "effect_id", "effectId",
    "colors", "asset", "skuId", "sku_id", "expires_at", "id", "type", "label", "palette", "badge",
    "tag", "identityEnabled", "identityGuildId", "identity_enabled", "identity_guild_id", "visibility"
]);

function validValue(value: unknown, depth = 0): value is Value {
    if (value === null || typeof value === "boolean") return true;
    if (typeof value === "string") return value.length <= 4096;
    if (typeof value === "number") return Number.isFinite(value);
    if (depth >= 4) return false;
    if (Array.isArray(value)) return value.length <= 256 && value.every(item => validValue(item, depth + 1));
    return !!value && typeof value === "object"
        && Object.entries(value).every(([key, item]) => safeKeys.has(key) && validValue(item, depth + 1));
}

export function validMedia(value: unknown): value is Media {
    const { type, data } = record(value);
    if (typeof data !== "string" || data.length < 16 || data.length > 16_000_000 || data.length % 4
        || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return false;
    return type === "image/gif" && (data.startsWith("R0lGODdh") || data.startsWith("R0lGODlh"))
        || type === "image/png" && data.startsWith("iVBORw0KGgo");
}

export function parsePreset(value: unknown): Preset {
    const { version, id, account, name, created, updated, profile, media } = record(value);
    if (version !== 1 || typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)
        || typeof account !== "string" || !/^\d{16,22}$/.test(account)
        || typeof name !== "string" || !name.trim() || name.length > 80
        || typeof created !== "number" || !Number.isSafeInteger(created) || created < 0
        || typeof updated !== "number" || !Number.isSafeInteger(updated) || updated < created
        || Object.keys(record(profile)).length !== fields.length || Object.keys(record(media)).some(key => key !== "avatar" && key !== "banner")
        || !media || typeof media !== "object" || Array.isArray(media)) {
        throw new Error("Invalid or unsupported preset.");
    }
    const cleanProfile = Object.fromEntries(fields.map(key => {
        const item = record(record(profile)[key]);
        if (item.state === "present" && validValue(item.value) && item.value !== null) {
            return [key, { state: item.state, value: item.value }];
        }
        if (item.state === "unset" || item.state === "unavailable" || item.state === "failed") {
            return [key, { state: item.state }];
        }
        throw new Error("Invalid profile field.");
    })) as Preset["profile"];
    const cleanMedia: Preset["media"] = {};
    for (const key of ["avatar", "banner"] as const) {
        const asset = record(media)[key];
        if (asset === undefined) continue;
        if (!validMedia(asset)) throw new Error("Invalid preset image.");
        cleanMedia[key] = { type: asset.type, data: asset.data };
    }
    return { version, id, account, name, created, updated, profile: cleanProfile, media: cleanMedia };
}

export function missing(preset: Preset): string[] {
    const result = fields.filter(key => ["failed", "unavailable"].includes(preset.profile[key].state)).map(String);
    for (const key of ["avatar", "banner"] as const) {
        if (preset.profile[key].state === "present" && !preset.media[key]) result.push(key + " image");
    }
    return result;
}

export function mediaPath(account: string, key: "avatar" | "banner", hash: string) {
    if (!/^\d{16,22}$/.test(account) || !/^(a_)?[a-f0-9]{32}$/i.test(hash)) return;
    const extension = hash.startsWith("a_") ? "gif" : "png";
    return `https://cdn.discordapp.com/${key}s/${account}/${hash}.${extension}?size=4096`;
}
