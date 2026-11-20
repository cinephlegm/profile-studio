import { record } from "./snapshot";

export type DisplayStyle = { font: number; effect: number; colors: number[]; };
export type CustomStatus = { text: string; emojiId: string; emojiName: string; expiresAtMs: string; };

export function displayStyle(value: unknown): DisplayStyle | undefined {
    const data = record(value);
    const font = data.font_id ?? data.fontId;
    const effect = data.effect_id ?? data.effectId;
    const { colors } = data;
    const valid = (item: unknown): item is number => typeof item === "number" && Number.isInteger(item) && item >= 0 && item <= 0xffffff;
    if (!valid(font) || !valid(effect) || !Array.isArray(colors) || colors.length > 2 || !colors.every(valid)) return;
    return { font, effect, colors };
}

export function statusValue(value: unknown): CustomStatus | undefined {
    const data = record(value);
    if (!Object.keys(data).some(key => ["text", "emojiId", "emojiName", "expiresAtMs"].includes(key))) return;
    const { text = "", emojiName = "", emojiId = "0", expiresAtMs = "0" } = data;
    if (typeof text !== "string" || text.length > 128 || typeof emojiName !== "string" || emojiName.length > 128
        || !/^(0|\d{16,22})$/.test(String(emojiId)) || !/^\d{1,16}$/.test(String(expiresAtMs))
        || !Number.isSafeInteger(Number(expiresAtMs))) return;
    return { text, emojiName, emojiId: String(emojiId), expiresAtMs: String(Number(expiresAtMs)) };
}

export function clanId(value: unknown): string | null | undefined {
    const data = record(value);
    const enabled = data.identity_enabled ?? data.identityEnabled;
    const id = data.identity_guild_id ?? data.identityGuildId;
    if (enabled === false || data.identity_enabled === null && data.identity_guild_id === null) return null;
    if (enabled === true && typeof id === "string" && /^\d{16,22}$/.test(id)) return id;
}

export function accountIdentityBody(field: string, value: unknown) {
    if (field !== "displayNameStyles") return;
    const style = value as DisplayStyle | null;
    return {
        display_name_font_id: style?.font ?? null,
        display_name_effect_id: style?.effect ?? null,
        display_name_colors: style?.colors ?? null,
    };
}

export function statusSetting(value: CustomStatus | null, now = Date.now()) {
    if (!value) return undefined;
    if (value.expiresAtMs !== "0" && Number(value.expiresAtMs) <= now) throw new Error("The saved custom status has expired.");
    return { ...value, createdAtMs: String(now) };
}
