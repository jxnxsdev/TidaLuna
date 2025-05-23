import Stack from "@mui/material/Stack";
import React from "react";

import { LunaTitle } from "./components";

import { LunaPlugin } from "@luna/core";
import { LunaPluginSettings } from "./lunaPageComponents/LunaPluginSettings";

export const SettingsTab = React.memo(() => {
	const corePlugins = [];
	for (const pluginName in LunaPlugin.plugins) {
		if (!LunaPlugin.lunaPlugins.includes(pluginName)) continue;
		corePlugins.push(<LunaPluginSettings key={pluginName} plugin={LunaPlugin.plugins[pluginName]} />);
	}
	return (
		<Stack spacing={2}>
			<Stack spacing={1}>
				<LunaTitle title="Luna plugins" desc="Plugins providing main luna functionality" />
				{corePlugins}
			</Stack>
		</Stack>
	);
});
