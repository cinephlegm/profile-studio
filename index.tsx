import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin from "@utils/types";
import { Modal, openModal, RestAPI, UserStore, useEffect, useState } from "@webpack/common";

import { executePlan, planApply, type Result } from "./apply";
import { capture, fetchInventory } from "./capture";
import { isCosmetic } from "./collectibles";
import { captureField, fields, missing, parsePreset, Preset } from "./snapshot";
import { changeLibrary, listPresets, loadRecovery, recoverLibrary, saveRecovery } from "./storage";
import "./style.css";

function downloadPreset(preset: Preset) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(preset)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `profile-studio-${preset.id}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

let applying = false;

function ProfileLibrary() {
    const [list, setList] = useState<Preset[]>([]);
    const [selected, select] = useState("");
    const [name, setName] = useState("");
    const [displayName, setDisplayName] = useState("");
    const [bio, setBio] = useState("");
    const [pronouns, setPronouns] = useState("");
    const [editing, setEditing] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const [results, setResults] = useState<Result[]>([]);
    const [pending, setPending] = useState<{ current: Preset; desired: Preset; restoring: boolean; plan: ReturnType<typeof planApply>; }>();
    const account = UserStore.getCurrentUser()?.id;
    const library = list.filter(preset => preset.account === account);
    const preset = library.find(item => item.id === selected) ?? library[0];
    const value = (field: keyof Preset["profile"]) => {
        const entry = preset?.profile[field];
        return entry?.state === "present" && typeof entry.value === "string" ? entry.value : "";
    };
    useEffect(() => {
        let mounted = true;
        listPresets().then(list => { if (mounted) setList(list); }, () => {
            if (mounted) setMessage("The preset library could not be read. Try Recover library.");
        });
        return () => { mounted = false; };
    }, []);

    async function run(action: () => Promise<void>, success: string) {
        setBusy(true);
        setMessage("");
        try {
            await action();
            setList(await listPresets());
            setMessage(success);
        } catch (error) {
            setMessage(error instanceof Error ? error.message : "Profile Studio could not complete the operation.");
        } finally {
            setBusy(false);
        }
    }

    async function prepare(restoring: boolean) {
        setPending(undefined);
        setResults([]);
        await run(async () => {
            const active = UserStore.getCurrentUser();
            if (!active?.id) throw new Error("Sign in to Discord first.");
            const desired = restoring ? await loadRecovery(active.id) : preset;
            if (!desired) throw new Error(restoring ? "There is no previous profile to restore." : "Select a preset first.");
            if (desired.account !== active.id) throw new Error("This preset belongs to another Discord account.");
            const [current, inventory] = await Promise.all([capture("Previous profile"), fetchInventory(active.id)]);
            const plan = planApply(current, desired, active.premiumType === 2, inventory);
            setPending({ current, desired, restoring, plan });
        }, "");
    }

    async function confirmApply() {
        if (!pending || applying) return;
        applying = true;
        setPending(undefined);
        try {
            await run(async () => {
                const { current, desired, restoring, plan } = pending;
                if (plan.operations.some(({ field }) => isCosmetic(field))) {
                    const inventory = await fetchInventory(desired.account);
                    const checked = planApply(current, desired, UserStore.getCurrentUser()?.premiumType === 2, inventory);
                    if (JSON.stringify(checked.operations) !== JSON.stringify(plan.operations)) {
                        throw new Error("Collectible availability changed. Open Apply or Restore again.");
                    }
                }
                const outcome = await executePlan(current, desired, plan, {
                    currentAccount: () => UserStore.getCurrentUser()?.id,
                    backup: snapshot => saveRecovery(snapshot, restoring),
                    read: () => capture("Profile verification"),
                    write: async ({ route, key, value }) => {
                        if (UserStore.getCurrentUser()?.id !== desired.account) throw new Error("The active Discord account changed.");
                        await RestAPI.patch({
                            url: route === "account" ? "/users/@me" : "/users/@me/profile",
                            body: { [key]: value },
                            oldFormErrors: true,
                        });
                    },
                });
                setResults(outcome);
            }, "Profile operation finished. See the results below.");
        } finally {
            applying = false;
        }
    }
    const chosenName = () => {
        const trimmed = name.trim();
        if (!trimmed) throw new Error("Enter a preset name.");
        return trimmed;
    };
    function add(item: Preset) {
        return changeLibrary(items => {
            if (items.some(existing => existing.id === item.id || existing.account === item.account && existing.name.toLowerCase() === item.name.toLowerCase())) {
                throw new Error("A preset with that name or ID already exists.");
            }
            return [...items, item];
        });
    }
    function replace(item: Preset) {
        return changeLibrary(items => {
            if (!items.some(existing => existing.id === item.id && existing.updated === preset?.updated)) throw new Error("The preset changed. Reopen Profile Studio.");
            if (items.some(existing => existing.id !== item.id && existing.account === item.account && existing.name.toLowerCase() === item.name.toLowerCase())) {
                throw new Error("A preset with that name already exists.");
            }
            return items.map(existing => existing.id === item.id ? item : existing);
        });
    }
    function save() {
        void run(async () => {
            const item = await capture(chosenName());
            await add(item);
            select(item.id);
        }, "Saved and read back the current profile.");
    }
    const colors = preset?.profile.themeColors;
    const swatches = colors?.state === "present" && Array.isArray(colors.value)
        ? colors.value.filter((color): color is number => typeof color === "number" && Number.isInteger(color) && color >= 0 && color <= 0xffffff)
        : [];
    const accent = preset?.profile.accentColor;
    const accentColor = accent?.state === "present" && typeof accent.value === "number"
        && Number.isInteger(accent.value) && accent.value >= 0 && accent.value <= 0xffffff ? accent.value : undefined;
    const hexColor = (color: number) => "#" + color.toString(16).padStart(6, "0").toUpperCase();
    const palette = [...new Set(accentColor === undefined ? swatches : [...swatches, accentColor])];
    const heroColors = swatches.length ? swatches : palette;
    const heroBackground = heroColors.length > 1 ? `linear-gradient(125deg, ${heroColors.map(hexColor).join(", ")})`
        : heroColors.length ? hexColor(heroColors[0]) : undefined;
    const image = (key: "avatar" | "banner") => {
        const media = preset?.media[key];
        return media && <img className={`ps-${key}`} src={`data:${media.type};base64,${media.data}`} alt={`Captured ${key}`} />;
    };
    const omitted = preset ? missing(preset) : [];
    const label = (field: string) => field.replace(/([A-Z])/g, " $1").toLowerCase();

    return <div className="ps-library" aria-busy={busy}>
        <form className="ps-capture" onSubmit={event => { event.preventDefault(); save(); }}>
            <label htmlFor="ps-name">Preset name</label>
            <div className="ps-capture-row">
                <input id="ps-name" value={name} maxLength={80} placeholder="Enter a name" onChange={event => setName(event.target.value)} />
                <button className="ps-primary" disabled={busy}>Save Current Profile</button>
            </div>
        </form>
        <div className="ps-workspace">
            <nav className="ps-sidebar" aria-label="Saved presets">
                <h2>Saved presets</h2>
                {library.map(item => <button key={item.id} aria-current={item.id === preset?.id ? "true" : undefined} disabled={busy} onClick={() => {
                    select(item.id);
                    setEditing(false);
                    setPending(undefined);
                    setResults([]);
                }}>{item.name}</button>)}
            </nav>
            <div className="ps-main">
        {preset && <>
            <div className="ps-preset-heading">
                <h2>{preset.name}</h2>
                <span className="ps-completeness">{omitted.length ? "Partial capture" : "Complete capture"}</span>
            </div>
            <section className="ps-preview" aria-label="Local preset preview">
                <div className="ps-hero" style={{ background: heroBackground }}>{image("banner")}</div>
                <div className="ps-details">
                    {image("avatar")}
                    <div className="ps-identity">
                        <h3>{value("displayName") || value("username")}</h3>
                        {value("username") && <div className="ps-meta">{value("username")}{value("pronouns") && ` · ${value("pronouns")}`}</div>}
                        {value("bio") && <p>{value("bio")}</p>}
                        {palette.length > 0 && <div className="ps-palette" aria-label="Captured profile colors">{palette.map(color => {
                            const hex = hexColor(color);
                            return <span key={color} className="ps-color"><span className="ps-swatch" aria-hidden="true" style={{ backgroundColor: hex }} />{hex}</span>;
                        })}</div>}
                    </div>
                </div>
            </section>
            <p className="ps-meta">Created {new Date(preset.created).toLocaleDateString()} · Updated {new Date(preset.updated).toLocaleDateString()}</p>
            {omitted.length > 0 && <p className="ps-meta">Missing {omitted.map(label).join(", ")}</p>}
            <details><summary>Captured fields</summary><dl className="ps-fields">{fields.map(field => {
                const entry = preset.profile[field];
                return <div key={field}><dt>{label(field)}</dt><dd>{entry.state === "present"
                    ? typeof entry.value === "string" ? entry.value : JSON.stringify(entry.value)
                    : entry.state}</dd></div>;
            })}</dl></details>
            <div className="ps-controls">
                <button className="ps-primary" disabled={busy} onClick={() => void prepare(false)}>Apply Preset</button>
                <button disabled={busy} onClick={() => void run(async () => {
                    await replace({ ...preset, name: chosenName(), updated: Date.now() });
                }, "Renamed preset.")}>Rename</button>
                <button disabled={busy} onClick={() => void run(async () => {
                    const id = crypto.randomUUID();
                    await add({ ...preset, id, name: chosenName(), created: Date.now(), updated: Date.now() });
                    select(id);
                }, "Duplicated preset.")}>Duplicate</button>
                <button disabled={busy} onClick={() => {
                    setDisplayName(value("displayName"));
                    setBio(value("bio"));
                    setPronouns(value("pronouns"));
                    setEditing(!editing);
                }}>Edit</button>
                <button disabled={busy} onClick={() => {
                    if (!window.confirm(`Replace the contents of "${preset.name}" with your current profile?`)) return;
                    void run(async () => {
                        const fresh = await capture(preset.name);
                        if (fresh.account !== preset.account) throw new Error("The signed-in account changed.");
                        await replace({ ...fresh, id: preset.id, created: preset.created });
                    }, "Updated preset from the current profile.");
                }}>Update From Current Profile</button>
                <button disabled={busy} onClick={() => downloadPreset(preset)}>Export</button>
                <button className="ps-danger" disabled={busy} onClick={() => {
                    if (window.confirm(`Delete "${preset.name}" from the local library?`)) {
                        void run(async () => { await changeLibrary(items => items.filter(item => item.id !== preset.id)); }, "Deleted preset.");
                    }
                }}>Delete</button>
            </div>
            {editing && <div className="ps-controls">
                <label>Display name <input maxLength={32} value={displayName} onChange={event => setDisplayName(event.target.value)} /></label>
                <label>Bio <textarea maxLength={190} value={bio} onChange={event => setBio(event.target.value)} /></label>
                <label>Pronouns <input maxLength={40} value={pronouns} onChange={event => setPronouns(event.target.value)} /></label>
                <button disabled={busy} onClick={() => void run(async () => {
                    await replace({
                        ...preset, updated: Date.now(), profile: {
                            ...preset.profile,
                            ...(displayName !== value("displayName") && { displayName: captureField(displayName) }),
                            ...(bio !== value("bio") && { bio: captureField(bio) }),
                            ...(pronouns !== value("pronouns") && { pronouns: captureField(pronouns) })
                        }
                    });
                    setEditing(false);
                }, "Saved local edits.")}>Save edits</button>
            </div>}
        </>}
        {!preset && <p className="ps-empty">Save your current profile or import a preset to get started.</p>}
            </div>
        </div>
        <div className="ps-controls ps-footer">
            <button disabled={busy} onClick={() => void prepare(true)}>Restore Previous Profile</button>
            <label className="ps-import">Import preset <input type="file" accept=".json,application/json" disabled={busy} onChange={event => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                void run(async () => {
                    if (file.size > 33_000_000) throw new Error("Preset file is too large.");
                    const item = parsePreset(JSON.parse(await file.text()));
                    if (item.account !== UserStore.getCurrentUser()?.id) throw new Error("This preset belongs to a different Discord account.");
                    await add(item);
                    select(item.id);
                }, "Imported preset.");
            }} /></label>
            <button disabled={busy} onClick={() => {
                if (window.confirm("Restore the previous local preset library?")) void run(recoverLibrary, "Recovered the previous library.");
            }}>Recover library</button>
        </div>
        {pending && <section className="ps-apply-preview" aria-label="Review profile changes">
            <h3>{pending.restoring ? "Restore previous profile" : `Apply ${pending.desired.name}`}</h3>
            <p>{pending.plan.operations.length ? "These changes will be sent to Discord after you confirm." : "There are no supported changes to apply."}</p>
            <dl className="ps-fields">{[
                ...pending.plan.operations.map(({ field, value }) => ({
                    field,
                    status: value === null || value === "" ? "Clear"
                        : typeof value === "string" && value.startsWith("data:image/") ? "Replace with saved image"
                            : Array.isArray(value) ? value.map(hexColor).join(", ") : value,
                })),
                ...pending.plan.results,
            ].map(({ field, status }) => <div key={field}><dt>{label(field)}</dt><dd>{status}</dd></div>)}</dl>
            <div className="ps-controls">
                {pending.plan.operations.length > 0 && <button className="ps-primary" disabled={busy} onClick={() => void confirmApply()}>
                    {pending.restoring ? "Confirm Restore" : "Confirm Apply"}
                </button>}
                <button onClick={() => setPending(undefined)}>Close review</button>
            </div>
        </section>}
        <p className="ps-message" role="status">{message}</p>
        {results.length > 0 && <details open><summary>Profile update results</summary><dl className="ps-fields">
            {results.map(({ field, status }) => <div key={field}><dt>{label(field)}</dt><dd>{status}</dd></div>)}
        </dl></details>}
    </div>;
}

function openLibrary() {
    openModal(props => <Modal {...props} title="Profile Studio" size="lg"><ErrorBoundary><ProfileLibrary /></ErrorBoundary></Modal>);
}

function AccountPanelPresetButton() {
    return (
        <button type="button" className="ps-account-button" title="Profile presets" aria-label="Open Profile Studio presets" onClick={openLibrary}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 8V6a2 2 0 0 1 2-2h12m-1 17H6a2 2 0 0 1-2-2V8m14-4a2 2 0 0 1 2 2v5" />
                <circle cx="10" cy="9" r="2" />
                <path d="M6.75 16a3.25 3.25 0 0 1 6.5 0M18 13l1.1 2.9L22 17l-2.9 1.1L18 21l-1.1-2.9L14 17l2.9-1.1L18 13Z" />
            </svg>
        </button>
    );
}

export default definePlugin({
    name: "ProfileStudio",
    description: "Save, preview and manage local Discord profile presets.",
    authors: [{ name: "Profile Studio", id: 0n }],
    toolboxActions: { "Open Profile Studio": openLibrary },
    patches: [
        {
            find: "#{intl::USER_PROFILE_ACCOUNT_POPOUT_BUTTON_A11Y_LABEL}",
            replacement: {
                // Match the native account container even when GameActivityToggle inserted its button first.
                match: /children:\[(?=(?:[^,\n]{0,150}\.GameActivityToggleButton\(arguments\[0\]\),)?.{0,25}?accountContainerRef)/,
                replace: "children:[$self.AccountPanelPresetButton(),"
            }
        }
    ],
    AccountPanelPresetButton: ErrorBoundary.wrap(AccountPanelPresetButton, { noop: true })
});
