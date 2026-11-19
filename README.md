# Profile Studio

Profile Studio is a custom Vencord plugin for saving and previewing Discord profile presets locally. It saves your avatar, banner, profile colors, and other profile fields that Discord makes available.

## Install

1. Download `profileStudio-v1.0.0.zip` from the [latest release](https://github.com/cinephlegm/profile-studio/releases/latest).
2. Extract the `profileStudio` folder into `src/userplugins/` in your Vencord source checkout.
3. [Build and install Vencord](https://docs.vencord.dev/installing/custom-plugins/), then enable **ProfileStudio** in Vencord's plugin settings.

## Use

Click the **Profile presets** icon in Discord's bottom-left account panel. Enter a name and click **Save Current Profile**. Select a saved preset to preview it, or export it as a JSON backup with its captured images.

A preset marked **Partial capture** lists any fields or images the plugin could not save. Changes made in Profile Studio are local. Applying a preset to your live Discord profile is currently unsupported.
