import { Constants, RestAPI, UserSettingsActionCreators, UserStore } from "@webpack/common";

import { type CapturedProfile, cosmeticTypes, parseInventory, readProfileCollectibles } from "./collectibles";
import { captureField, Field, mediaPath, Preset, record, validMedia } from "./snapshot";

async function download(account: string, key: "avatar" | "banner", field: Field, signal?: AbortSignal) {
    if (field.state !== "present" || typeof field.value !== "string") return;
    const url = mediaPath(account, key, field.value);
    if (!url) return;
    try {
        const response = await fetch(url, {
            credentials: "omit", redirect: "error",
            signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000)
        });
        if (!response.ok) return;
        const type = response.headers.get("content-type");
        if (type !== (field.value.startsWith("a_") ? "image/gif" : "image/png")) return;
        const reader = response.body?.getReader();
        if (!reader) return;
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        let size = 0;
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 12_000_000) {
                await reader.cancel();
                return;
            }
            chunks.push(new Uint8Array(value));
        }
        const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
        const asset = { type, data: bytes.toBase64() };
        if (validMedia(asset)) return asset;
    } catch {
        // An unavailable image leaves its captured hash intact.
    }
}

const cosmeticKeys = ["asset", "sku_id", "skuId", "expires_at", "id", "type", "label", "palette"];

export async function fetchInventory(account: string) {
    try {
        const endpoint = (Constants.Endpoints as unknown as Record<string, unknown>).COLLECTIBLES_PURCHASES;
        if (typeof endpoint !== "string" || UserStore.getCurrentUser()?.id !== account) return;
        const { body } = await RestAPI.get({ url: endpoint, oldFormErrors: true });
        if (UserStore.getCurrentUser()?.id === account) return parseInventory(body);
    } catch {
        // An unavailable inventory must never authorize a collectible change.
    }
}

function customStatus(): Field {
    try {
        const status = record(UserSettingsActionCreators.PreloadedUserSettingsActionCreators.getCurrentValue()).status;
        if (!status || typeof status !== "object") return { state: "unavailable" };
        const value = record(status).customStatus;
        if (value === undefined) return { state: "unset" };
        const { text, emojiId, emojiName, expiresAtMs } = record(value);
        const normalized = {
            ...(typeof text === "string" && { text }),
            ...(typeof emojiId === "string" && { emojiId }),
            ...(typeof emojiName === "string" && { emojiName }),
            ...(typeof expiresAtMs === "bigint" || typeof expiresAtMs === "string" || typeof expiresAtMs === "number"
                ? { expiresAtMs: String(expiresAtMs) } : {})
        };
        return Object.keys(normalized).length ? captureField(normalized) : captureField(value, []);
    } catch {
        return { state: "failed" };
    }
}

export async function capture(name: string, signal?: AbortSignal): Promise<CapturedProfile> {
    const current = UserStore.getCurrentUser();
    if (!current?.id) throw new Error("Sign in to Discord before capturing a preset.");
    const account = current.id;
    const started = Date.now();
    const status = customStatus();
    let response: Record<string, unknown> = {};
    let profileFailed = false;
    try {
        const { body } = await RestAPI.get({
            url: Constants.Endpoints.USER_PROFILE(account),
            query: { with_mutual_guilds: false, with_mutual_friends_count: false },
            oldFormErrors: true,
        });
        response = record(body);
        if (record(response.user).id !== account) throw new Error();
    } catch {
        profileFailed = true;
        response = {};
    }
    const source = record(response.user);
    const own = (key: string, fallback: unknown) => Object.hasOwn(source, key) ? source[key] : fallback;
    const saved = record(response.user_profile);
    const profileCollectibles = readProfileCollectibles(saved.collectibles);
    const readProfile = (key: string, keys?: readonly string[]): Field =>
        profileFailed ? { state: "failed" } : captureField(saved[key], keys);
    const collectibles = own("collectibles", current.collectibles);
    const nameplate = collectibles === null ? null : Object.hasOwn(record(collectibles), "nameplate")
        ? record(collectibles).nameplate : current.nameplate;
    function profileCollectible(key: string, type: number) {
        if (profileFailed) return { state: "failed" } as const;
        if (Array.isArray(saved.collectibles)) {
            const selected = saved.collectibles.find(item => record(item).type === type);
            if (selected) return captureField(selected, cosmeticKeys);
            if (Object.hasOwn(saved, key)) return readProfile(key, cosmeticKeys);
            return captureField(saved.collectibles.every(item => typeof record(item).type === "number") ? null : undefined);
        }
        if (Object.hasOwn(saved, key)) return readProfile(key, cosmeticKeys);
        if (saved.collectibles === null) return captureField(null);
        const nested = record(saved.collectibles);
        if (Object.hasOwn(nested, key)) return captureField(nested[key], cosmeticKeys);
        const idKey = key === "profile_frame" ? "profile_frame_sku_id" : "profile_effect_id";
        const id = saved[idKey];
        return typeof id === "string" ? captureField({ id }) : captureField(id, cosmeticKeys);
    }
    const profile: Preset["profile"] = {
        username: captureField(own("username", current.username)),
        displayName: captureField(own("global_name", current.globalName)),
        avatar: captureField(own("avatar", current.avatar)),
        banner: Object.hasOwn(saved, "banner") ? readProfile("banner") : captureField(own("banner", current.banner)),
        bio: readProfile("bio"),
        pronouns: readProfile("pronouns"),
        customStatus: status,
        accentColor: readProfile("accent_color"),
        themeColors: readProfile("theme_colors"),
        displayNameStyles: captureField(own("display_name_styles", current.displayNameStyles), ["font_id", "fontId", "effect_id", "effectId", "colors"]),
        avatarDecoration: captureField(own("avatar_decoration_data", current.avatarDecorationData), cosmeticKeys),
        profileEffect: profileCollectible("profile_effect", cosmeticTypes.profileEffect),
        profileFrame: profileCollectible("profile_frame", cosmeticTypes.profileFrame),
        nameplate: captureField(nameplate, cosmeticKeys),
        primaryGuild: captureField(own("primary_guild", current.primaryGuild), ["badge", "tag", "identityEnabled", "identityGuildId", "identity_enabled", "identity_guild_id"]),
        connectionVisibility: { state: "unavailable" },
    };
    const [avatar, banner] = await Promise.all([
        download(account, "avatar", profile.avatar, signal),
        download(account, "banner", profile.banner, signal)
    ]);
    signal?.throwIfAborted();
    if (UserStore.getCurrentUser()?.id !== account) throw new Error("The signed-in account changed during capture.");
    return {
        version: 1, id: crypto.randomUUID(), account, name,
        created: started, updated: started, profile,
        profileCollectibles,
        media: { ...(avatar && { avatar }), ...(banner && { banner }) }
    };
}
