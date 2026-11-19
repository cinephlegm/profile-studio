import { get, set, update } from "@api/DataStore";

import { parsePreset, Preset } from "./snapshot";

const key = "ProfileStudio.library.v1";
type Library = { version: 1; presets: Preset[]; previous: Preset[]; };

function parseList(value: unknown): Preset[] {
    if (!Array.isArray(value) || value.length > 100) throw new Error("Invalid preset library.");
    const parsed = value.map(parsePreset);
    if (new Set(parsed.map(preset => preset.id)).size !== parsed.length) throw new Error("Duplicate preset IDs.");
    return parsed;
}

function read(value: Library | undefined): Library {
    if (value === undefined) return { version: 1, presets: [], previous: [] };
    if (value?.version !== 1) throw new Error("Unsupported preset library version.");
    return { version: 1, presets: parseList(value.presets), previous: parseList(value.previous) };
}

export async function listPresets() {
    return read(await get<Library>(key)).presets;
}

export async function changeLibrary(change: (presets: Preset[]) => Preset[]) {
    await update<Library>(key, raw => {
        const library = read(raw);
        const next = change(library.presets);
        return next === library.presets ? library : { version: 1, presets: parseList(next), previous: library.presets };
    });
    return listPresets();
}

export async function recoverLibrary() {
    const stored = await get<Library>(key);
    if (stored?.version !== 1) throw new Error("No compatible library backup.");
    const previous = parseList(stored.previous);
    try {
        const current = read(stored);
        await changeLibrary(() => current.previous);
    } catch {
        await set(key, { version: 1, presets: previous, previous });
    }
}
