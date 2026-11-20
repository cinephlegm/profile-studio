import { type FieldName, type Preset, record } from "./snapshot";

export const cosmeticTypes = {
    avatarDecoration: 0,
    profileEffect: 1,
    nameplate: 2,
    profileFrame: 3,
} as const;

export type Cosmetic = keyof typeof cosmeticTypes;
export type Inventory = ReadonlySet<string>;

export function isCosmetic(field: FieldName): field is Cosmetic {
    return Object.hasOwn(cosmeticTypes, field);
}

export function collectibleId(value: unknown): string | undefined {
    const { sku_id, skuId, id } = record(value);
    const identifier = sku_id ?? skuId ?? id;
    return typeof identifier === "string" && /^\d{16,22}$/.test(identifier) ? identifier : undefined;
}

export function equipped(preset: Preset, field: Cosmetic): string | null | undefined {
    const entry = preset.profile[field];
    if (entry.state === "unset") return null;
    if (entry.state === "present") return collectibleId(entry.value);
}

export function parseInventory(body: unknown, now = Date.now()): Inventory | undefined {
    if (!Array.isArray(body)) return;
    const inventory = new Set<string>();
    for (const entry of body) {
        const { expires_at, items } = record(entry);
        if (expires_at != null && (typeof expires_at !== "string" || !(Date.parse(expires_at) > now))) continue;
        if (!Array.isArray(items)) continue;
        for (const item of items) {
            const { type, expires_at: itemExpiry } = record(item);
            if (itemExpiry != null && (typeof itemExpiry !== "string" || !(Date.parse(itemExpiry) > now))) continue;
            const id = collectibleId(item);
            if (id && typeof type === "number" && Object.values(cosmeticTypes).some(value => value === type)) inventory.add(`${type}:${id}`);
        }
    }
    return inventory;
}
