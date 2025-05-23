import type { MaybePromise, VoidLike } from "@inrixia/helpers";
import type { ActionType } from "./intercept.actionTypes";

import { buildActions, reduxStore } from "@luna/core";

export type { ActionTypes as OutdatedActionPayloads } from "neptune-types/tidal";

export type LunaAction<P = unknown> = P extends VoidLike ? () => MaybePromise<VoidLike> : (payload?: P) => MaybePromise<VoidLike>;
export type LunaActions = {
	[K in ActionType]: LunaAction;
};

export const actions: LunaActions = <LunaActions>{};
for (const [name, buildAction] of Object.entries(buildActions)) {
	actions[name as keyof LunaActions] = (...args: any[]) => reduxStore.dispatch(buildAction(...args));
}

export { reduxStore as store };
