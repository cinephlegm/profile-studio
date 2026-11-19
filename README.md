# Profile Studio

Profile Studio is a custom Vencord plugin for saving and previewing Discord profile presets locally. It saves your avatar, banner, profile colors, and other profile fields that Discord makes available.

## Install

1. Download the ZIP from the [latest release](https://github.com/cinephlegm/profile-studio/releases/latest).
2. Extract the `profileStudio` folder into `src/userplugins/` in your Vencord source checkout.
3. [Build and install Vencord](https://docs.vencord.dev/installing/custom-plugins/), then enable **ProfileStudio** in Vencord's plugin settings.

## Use

Click the **Profile presets** icon in Discord's bottom-left account panel. Enter a name and click **Save Current Profile**. Select a saved preset to preview it, or export it as a JSON backup with its captured images.

Click **Apply Preset**, review the changes, and confirm. Profile Studio saves a local recovery snapshot before sending any changes to Discord. Use **Restore Previous Profile** to review and reapply that snapshot.

Apply and restore support display name, bio, pronouns, avatar, banner, and theme colors. Some appearance changes require full Nitro. Cosmetics, display-name styles, custom status, and guild tags are capture-only. A preset marked **Partial capture** lists the fields or images that could not be saved. Check the per-field results after applying, especially if Discord rejected a change.
